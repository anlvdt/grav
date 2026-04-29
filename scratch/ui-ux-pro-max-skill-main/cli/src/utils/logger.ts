import chalk from 'chalk';

export const logger = {
  info: (msg: string) => console.log(`${chalk.bgCyan.black(' INFO ')} ${chalk.cyan(msg)}`),
  success: (msg: string) => console.log(`\n${chalk.bgGreen.black.bold(' SUCCESS ')} ${chalk.greenBright(msg)}`),
  warn: (msg: string) => console.log(`\n${chalk.bgYellow.black(' WARN ')} ${chalk.yellow(msg)}`),
  error: (msg: string) => console.log(`\n${chalk.bgRed.white.bold(' ERROR ')} ${chalk.red(msg)}\n`),

  title: (msg: string) => {
    console.log('\n' + chalk.hex('#3B82F6').bold('╭' + '─'.repeat(msg.length + 2) + '╮'));
    console.log(`${chalk.hex('#3B82F6').bold('│')} ${chalk.bold.white(msg)} ${chalk.hex('#3B82F6').bold('│')}`);
    console.log(chalk.hex('#3B82F6').bold('╰' + '─'.repeat(msg.length + 2) + '╯') + '\n');
  },
  
  dim: (msg: string) => console.log(chalk.gray(`  └─ ${msg}`)),
  step: (msg: string) => console.log(chalk.magenta('◆ ') + chalk.white(msg)),
  done: (msg: string) => console.log(chalk.green('✔ ') + chalk.white(msg)),
};
