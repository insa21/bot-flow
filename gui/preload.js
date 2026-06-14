// preload.js — Hanya berisi contextBridge API (bridge antara main & renderer)
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('botAPI', {
    // Window controls
    minimize: ()          => ipcRenderer.send('win-minimize'),
    maximize: ()          => ipcRenderer.send('win-maximize'),
    close:    ()          => ipcRenderer.send('win-close'),

    // Config & prompts
    readConfig:        ()        => ipcRenderer.invoke('read-config'),
    readPrompts:       ()        => ipcRenderer.invoke('read-prompts'),

    // Dialogs
    chooseFolder:      ()        => ipcRenderer.invoke('choose-folder'),
    choosePromptsFile: ()        => ipcRenderer.invoke('choose-prompts-file'),

    // Bot control
    startBot: payload => ipcRenderer.invoke('start-bot', payload),
    stopBot:  ()      => ipcRenderer.invoke('stop-bot'),

    // File system
    openOutputFolder: p       => ipcRenderer.send('open-output-folder', p),
    openImage:        p       => ipcRenderer.send('open-image', p),
    revealImage:      p       => ipcRenderer.send('reveal-image', p),
    scanImages:       p       => ipcRenderer.invoke('scan-images', p),
    scanTrashImages:  p       => ipcRenderer.invoke('scan-trash-images', p),
    getFileDate:      p       => ipcRenderer.invoke('get-file-date', p),
    getFileStats:     p       => ipcRenderer.invoke('get-file-stats', p),
    deleteImage:      p       => ipcRenderer.invoke('delete-image', p),
    renameImage:      (o, n)  => ipcRenderer.invoke('rename-image', { oldPath: o, newPath: n }),
    clearGallery:     p       => ipcRenderer.invoke('clear-gallery', p),
    undoDelete:       payload => ipcRenderer.invoke('undo-delete', payload),
    restoreTrashImage: p      => ipcRenderer.invoke('restore-trash-image', p),
    deleteTrashImagePermanently: p => ipcRenderer.invoke('delete-trash-image-permanently', p),
    emptyTrash:       p       => ipcRenderer.invoke('empty-trash', p),
    exportLog:        txt     => ipcRenderer.invoke('export-log', txt),

    // Events: main → renderer
    onLogLine:     cb => ipcRenderer.on('log-line',     (_, d) => cb(d)),
    onBotStatus:   cb => ipcRenderer.on('bot-status',   (_, d) => cb(d)),
    onBotProgress: cb => ipcRenderer.on('bot-progress', (_, d) => cb(d)),
    onNewImage:    cb => ipcRenderer.on('new-image',    (_, d) => cb(d)),
});
