import { program } from 'commander';
import { CodeExtractor } from './extractor';
import { watch } from 'fs';
import chalk from 'chalk';
import path from 'path';

// CLI Configuration
program
  .name('claude-code-extractor')
  .description('Extract code blocks and artifacts from Claude\'s responses')
  .version('1.0.0')
  .requiredOption('-i, --input <path>', 'Input file path containing Claude\'s response')
  .option('-o, --output <directory>', 'Output directory for extracted files', './extracted')
  .option('--overwrite', 'Overwrite existing files', false)
  .parse(process.argv);

const options = program.opts();

async function processFile() {
  const extractor = new CodeExtractor({
    inputPath: options.input,
    outputDir: options.output,
    overwrite: options.overwrite
  });

  await extractor.process();
}

// Watch file for changes
const watchFile = () => {
  const absolutePath = path.resolve(options.input);
  console.log(chalk.cyan(`Watching for changes in: ${absolutePath}`));

  watch(absolutePath, { persistent: true }, async (eventType) => {
    if (eventType === 'change') {
      console.log(chalk.yellow('\nFile changes detected, processing...'));
      await processFile();
    }
  });
};

// Initial processing and start watching
processFile().then(() => {
  watchFile();
});
