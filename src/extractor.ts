import fs from 'fs/promises';
import path from 'path';
import chalk from 'chalk';
import { createInterface } from 'readline';
import { ParsedComment } from './types';

interface FileMetadata {
  language: string;
  fileName: string;
  filePath: string;
  content: string;
  type: string;
}

interface ExtractorOptions {
  inputPath: string;
  outputDir: string;
  overwrite: boolean;
}

interface CodeBlock {
  path: string;
  content: string;
}

export class CodeExtractor {
  private static readonly LANGUAGE_EXTENSIONS: Record<string, string> = {
    typescript: '.ts',
    javascript: '.js',
    python: '.py',
    java: '.java',
    cpp: '.cpp',
    'c++': '.cpp',
    'c#': '.cs',
    rust: '.rs',
    go: '.go',
    ruby: '.rb',
    php: '.php',
    html: '.html',
    css: '.css',
    sql: '.sql',
    yaml: '.yml',
    json: '.json',
    xml: '.xml',
    markdown: '.md',
    shell: '.sh',
    bash: '.sh',
    zsh: '.sh',
    powershell: '.ps1',
  };

  private static readonly CODE_BLOCK_REGEX = /```(\w+)?\n([\s\S]*?)```/g;
  private static readonly ARTIFACT_REGEX = /<antArtifact[^>]*>([\s\S]*?)<\/antArtifact>/g;
  private static readonly ARTIFACT_ATTRS_REGEX = /(\w+)="([^"]*?)"/g;
  private static readonly PATH_COMMENT_REGEX = /\/\/\s*([^\n]+)/;

  
  private readonly rl = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  constructor(private options: ExtractorOptions) {}

  private async promptUser(message: string): Promise<boolean> {
    return new Promise((resolve) => {
      this.rl.question(message, (answer) => {
        resolve(answer.toLowerCase().startsWith('y'));
      });
    });
  }

  private async extractFiles(content: string): Promise<FileMetadata[]> {
    const files: FileMetadata[] = [];
    const processedPaths = new Set<string>();

    // Process code blocks with path comments
    const regularBlocks = this.splitIntoCodeBlocks(content);
    for (const block of regularBlocks) {
      const fileInfo = this.processCodeBlock(block);
      if (fileInfo && !processedPaths.has(fileInfo.filePath)) {
        files.push(fileInfo);
        processedPaths.add(fileInfo.filePath);
      }
    }

    // Process artifacts
    let match;
    while ((match = CodeExtractor.ARTIFACT_REGEX.exec(content)) !== null) {
      const artifactContent = match[1];
      const attributes: Record<string, string> = {};
      
      let attrMatch;
      while ((attrMatch = CodeExtractor.ARTIFACT_ATTRS_REGEX.exec(match[0])) !== null) {
        attributes[attrMatch[1]] = attrMatch[2];
      }

      if (attributes.type?.includes('code') || attributes.type?.includes('html')) {
        const language = attributes.language || this.detectLanguage(artifactContent);
        const artifactBlocks = this.splitIntoCodeBlocks(artifactContent);
        
        for (const block of artifactBlocks) {
          const fileInfo = this.processCodeBlock(block, language);
          if (fileInfo && !processedPaths.has(fileInfo.filePath)) {
            files.push(fileInfo);
            processedPaths.add(fileInfo.filePath);
          }
        }
      }
    }

    return files;
  }


  private static readonly PATH_PATTERNS = [
    /\/\/\s*([\w-]+\/[\w/-]+\.\w+)(?:\s*:\s*(.+))?/,  // Matches paths with optional description
    /\/\/\s*@file\s+([\w-]+\/[\w/-]+\.\w+)/,          // Matches "@file" directive
    /\/\/\s*filepath:\s*([\w-]+\/[\w/-]+\.\w+)/       // Matches "filepath:" directive
  ];

  private static isValidPath(path: string): boolean {
    // Check if path has valid structure and extension
    return /^[\w-]+\/[\w/-]+\.\w+$/.test(path) && 
           !path.includes('..') &&                    // Prevent directory traversal
           !path.startsWith('/') &&                   // Must be relative
           !path.includes('\\');                      // Use forward slashes only
  }

  private static parseComment(line: string): ParsedComment {
    // Remove leading/trailing whitespace
    line = line.trim();

    // If not a comment, return early
    if (!line.startsWith('//')) {
      return { isPath: false };
    }

    // Try all path patterns
    for (const pattern of CodeExtractor.PATH_PATTERNS) {
      const match = pattern.exec(line);
      if (match) {
        const [, path, description] = match;
        if (CodeExtractor.isValidPath(path)) {
          return {
            isPath: true,
            path: path,
            comment: description
          };
        }
      }
    }

    // If no path pattern matches, it's a regular comment
    return { isPath: false, comment: line.slice(2).trim() };
  }
  private splitIntoCodeBlocks(content: string): CodeBlock[] {
    const blocks: CodeBlock[] = [];
    let currentPath: string | null = null;
    let currentContent: string[] = [];
    let inCodeBlock = false;
    let codeBlockContent = '';

    const lines = content.split('\n');
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      
      // Handle code block markers
      if (line.trim().startsWith('```')) {
        if (inCodeBlock) {
          // End of code block
          if (currentPath) {
            currentContent.push(codeBlockContent);
          }
          codeBlockContent = '';
          inCodeBlock = false;
        } else {
          // Start of code block
          inCodeBlock = true;
        }
        continue;
      }

      if (inCodeBlock) {
        codeBlockContent += line + '\n';
        continue;
      }

      const parsedComment = CodeExtractor.parseComment(line);

      if (parsedComment.isPath) {
        // Save previous block if exists
        if (currentPath && currentContent.length > 0) {
          blocks.push({
            path: currentPath,
            content: currentContent.join('\n').trim()
          });
          currentContent = [];
        }
        currentPath = parsedComment.path!;
        
        // If there's a description comment, add it to the content
        if (parsedComment.comment) {
          currentContent.push(`// ${parsedComment.comment}`);
        }
      } else if (currentPath) {
        currentContent.push(line);
      }
    }

    // Save the last block
    if (currentPath && currentContent.length > 0) {
      blocks.push({
        path: currentPath,
        content: currentContent.join('\n').trim()
      });
    }

    return blocks;
  }
  private processCodeBlock(
    block: CodeBlock,
    defaultLanguage?: string
  ): FileMetadata | null {
    const filePath = path.join(this.options.outputDir, block.path);
    const language = defaultLanguage || this.detectLanguageFromPath(block.path);

    return {
      language,
      fileName: path.basename(filePath),
      filePath,
      content: block.content,
      type: 'code-block'
    };
  }

  private async writeFiles(files: FileMetadata[]): Promise<void> {
    const errors: Array<{ path: string; error: Error }> = [];

    for (const file of files) {
      try {
        await this.ensureDirectoryExists(file.filePath);

        if (!this.options.overwrite) {
          try {
            await fs.access(file.filePath);
            console.log(
              chalk.yellow(`File ${file.filePath} already exists. Skipping...`)
            );
            continue;
          } catch {
            // File doesn't exist, proceed with writing
          }
        }

        await fs.writeFile(file.filePath, file.content);
        console.log(chalk.green(`Created ${file.filePath}`));
      } catch (error) {
        errors.push({ path: file.filePath, error: error as Error });
      }
    }

    if (errors.length > 0) {
      console.error(chalk.red('\nErrors occurred during file writing:'));
      errors.forEach(({ path, error }) => {
        console.error(chalk.red(`- ${path}: ${error.message}`));
      });
    }
  }

  private async ensureDirectoryExists(filePath: string): Promise<void> {
    const dirPath = path.dirname(filePath);
    await fs.mkdir(dirPath, { recursive: true });
  }

  private detectLanguageFromPath(filePath: string): string {
    const ext = path.extname(filePath).slice(1);
    for (const [lang, langExt] of Object.entries(CodeExtractor.LANGUAGE_EXTENSIONS)) {
      if (langExt === `.${ext}`) return lang;
    }
    return 'txt';
  }

  private detectLanguage(content: string): string {
    if (content.includes('import { useState }')) return 'typescript';
    if (content.includes('def ')) return 'python';
    if (content.includes('public class ')) return 'java';
    if (content.includes('<?php')) return 'php';
    if (content.includes('<!DOCTYPE html>')) return 'html';
    return 'txt';
  }

  public async process(): Promise<void> {
    try {
      console.log(chalk.cyan(`Processing input file: ${this.options.inputPath}`));
      const content = await fs.readFile(this.options.inputPath, 'utf-8');
      const files = await this.extractFiles(content);

      if (files.length === 0) {
        console.log(chalk.yellow('No code blocks or artifacts found in the input file.'));
        return;
      }

      // Check for existing files
      const existingFiles = await this.checkExistingFiles(files);
      if (existingFiles.length > 0) {
        console.log(chalk.yellow('\nThe following files already exist:'));
        existingFiles.forEach(file => {
          console.log(chalk.yellow(`- ${file}`));
        });

        const shouldContinue = await this.promptUser(
          chalk.yellow('\nDo you want to overwrite these files? (y/N): ')
        );

        if (!shouldContinue) {
          console.log(chalk.red('Operation cancelled by user.'));
          this.rl.close();
          return;
        }
        this.options.overwrite = true;
      }

      await this.writeFiles(files);

      console.log(chalk.green('\nExtraction completed successfully!'));
      console.log(chalk.cyan('\nGenerated files:'));
      files.forEach(file => {
        console.log(chalk.white(`- ${file.filePath}`));
      });

      this.rl.close();
    } catch (error) {
      console.error(chalk.red('Error processing file:'), error);
      this.rl.close();
      process.exit(1);
    }
  }

  private async checkExistingFiles(files: FileMetadata[]): Promise<string[]> {
    const existingFiles: string[] = [];

    for (const file of files) {
      try {
        await fs.access(file.filePath);
        existingFiles.push(file.filePath);
      } catch {
        // File doesn't exist
      }
    }

    return existingFiles;
  }
}
