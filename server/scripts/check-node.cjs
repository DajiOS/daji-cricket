// Runs before start and test: this project needs Node 22.22 or newer (built-in SQLite, TypeScript files run directly).
const [maj, min] = process.versions.node.split('.').map(Number);
if (maj < 22 || (maj === 22 && min < 22)) {
  console.error(`\nThis project needs Node 22.22 or newer. You have Node ${process.versions.node}.\nInstall the current LTS from https://nodejs.org (or run: winget install OpenJS.NodeJS.LTS), open a new terminal, and try again.\n`);
  process.exit(1);
}
