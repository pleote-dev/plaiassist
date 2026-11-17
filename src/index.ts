// Main entry point for the Avatar Assistant MCP application
import { spawn } from 'child_process';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Start the desktop window (Electron app)
console.log('Starting Avatar Assistant MCP...');

// In a real implementation, you would:
// 1. Start the MCP server
// 2. Start the Electron desktop window
// 3. Connect them via IPC/WebSocket

// For now, just start the MCP server
const mcpServer = spawn('node', [path.join(__dirname, 'mcp-server.js')], {
  stdio: 'inherit'
});

mcpServer.on('error', (error) => {
  console.error('Failed to start MCP server:', error);
});

mcpServer.on('exit', (code) => {
  console.log(`MCP server exited with code ${code}`);
});
