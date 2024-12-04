export interface FileMetadata {
  language: string;
  fileName: string;
  filePath: string;
  content: string;
  type: string;
}

export interface ExtractorOptions {
  inputPath: string;
  outputDir: string;
  overwrite: boolean;
}

export interface CodeBlock {
  path: string;
  content: string;
}
export interface ParsedComment {
  path?: string;
  isPath: boolean; comment?: string
}
