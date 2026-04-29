const { execSync } = require('child_process');
try {
    console.log('Running vsce package...');
    const result = execSync('npx -y @vscode/vsce package --no-dependencies', { encoding: 'utf8' });
    console.log(result);
} catch (error) {
    console.error('Build failed:');
    console.error(error.stdout);
    console.error(error.stderr);
}
