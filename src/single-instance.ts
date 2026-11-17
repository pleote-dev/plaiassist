import { app } from 'electron';

export class SingleInstance {
    private static instance: SingleInstance;
    private isMainInstance: boolean = false;

    private constructor() {
        this.setupSingleInstance();
    }

    public static getInstance(): SingleInstance {
        if (!SingleInstance.instance) {
            SingleInstance.instance = new SingleInstance();
        }
        return SingleInstance.instance;
    }

    private setupSingleInstance(): void {
        // Get the lock for single instance
        const gotTheLock = app.requestSingleInstanceLock();

        if (!gotTheLock) {
            // Another instance is already running, quit this one
            console.log('Another instance of Avatar Assistant is already running. Quitting...');
            app.quit();
            return;
        }

        this.isMainInstance = true;
        console.log('Avatar Assistant is the main instance');

        // Someone tried to run a second instance, we should focus our window
        app.on('second-instance', (event, commandLine, workingDirectory) => {
            console.log('Second instance detected, focusing main window');
            
            // Someone tried to run a second instance, we should focus our window
            if (this.mainWindow) {
                if (this.mainWindow.isMinimized()) this.mainWindow.restore();
                this.mainWindow.focus();
                this.mainWindow.show();
            }

            // Show a notification that we're already running
            this.showAlreadyRunningNotification();
        });

        // Handle app ready
        app.whenReady().then(() => {
            console.log('App ready, single instance lock acquired');
        });
    }

    private mainWindow: Electron.BrowserWindow | null = null;

    public setMainWindow(window: Electron.BrowserWindow): void {
        this.mainWindow = window;
    }

    public isMain(): boolean {
        return this.isMainInstance;
    }

    private showAlreadyRunningNotification(): void {
        // Try to show a system notification
        if (process.platform === 'darwin') {
            // macOS notification
            const { exec } = require('child_process');
            exec(`osascript -e 'display notification "Avatar Assistant is already running" with title "Avatar Assistant"'`);
        } else if (process.platform === 'win32') {
            // Windows notification
            const { exec } = require('child_process');
            exec('powershell -Command "& {Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.MessageBox]::Show(\'Avatar Assistant is already running\', \'Avatar Assistant\', [System.Windows.Forms.MessageBoxButtons]::OK, [System.Windows.Forms.MessageBoxIcon]::Information)}"');
        } else {
            // Linux notification
            const { exec } = require('child_process');
            exec('notify-send "Avatar Assistant" "Avatar Assistant is already running"');
        }
    }
}

// Export singleton instance
export const singleInstance = SingleInstance.getInstance();
