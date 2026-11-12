// preload.js â€” Hanya berisi contextBridge API (bridge antara main & renderer)
'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('botAPI', {
    // Window controls
    minimize: ()          => ipcRenderer.send('win-minimize'),
    maximize: ()          => ipcRenderer.send('win-maximize'),
    close:    ()          => ipcRenderer.send('win-close'),

    // Config & prompts
    readConfig:        ()        => ipcRenderer.invoke('read-config'),
    saveConfig:        cfg       => ipcRenderer.invoke('save-config', cfg),
    readPrompts:       ()        => ipcRenderer.invoke('read-prompts'),

    // Dialogs
    chooseFolder:      ()        => ipcRenderer.invoke('choose-folder'),
    choosePromptsFile: ()        => ipcRenderer.invoke('choose-prompts-file'),

    // Bot control (single session - tab lama)
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

    // â”€â”€ Account Management â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    accountList:        ()         => ipcRenderer.invoke('account:list'),
    accountGetActive:   ()         => ipcRenderer.invoke('account:getActive'),
    accountAdd:         ()         => ipcRenderer.invoke('account:add'),
    accountCancelLogin: ()         => ipcRenderer.invoke('account:cancelLogin'),
    accountDelete:      id         => ipcRenderer.invoke('account:delete', id),
    accountRename:      (id, name) => ipcRenderer.invoke('account:rename', { accountId: id, newName: name }),
    accountSetActive:   id         => ipcRenderer.invoke('account:setActive', id),

    // â”€â”€ Multi-Session (Parallel) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
    sessionList:         ()             => ipcRenderer.invoke('session:list'),
    sessionCreate:       cfg            => ipcRenderer.invoke('session:create', cfg),
    sessionDelete:       id             => ipcRenderer.invoke('session:delete', id),
    sessionUpdate:       (id, fields)   => ipcRenderer.invoke('session:update', { id, fields }),
    sessionChooseDir:         id             => ipcRenderer.invoke('session:chooseDir', id),
    sessionChoosePromptsFile: id             => ipcRenderer.invoke('session:choosePromptsFile', id),
    sessionSplitPrompts: (promptsText)  => ipcRenderer.invoke('session:splitPrompts', { promptsText }),
    sessionStart:        id             => ipcRenderer.invoke('session:start', id),
    sessionStop:         id             => ipcRenderer.invoke('session:stop', id),
    sessionStartAll:     ()             => ipcRenderer.invoke('session:startAll'),
    sessionStopAll:      ()             => ipcRenderer.invoke('session:stopAll'),
    sessionReset:             id             => ipcRenderer.invoke('session:reset', id),
    sessionChoosePromptsFile: id             => ipcRenderer.invoke('session:choosePromptsFile', id),

    // Events: main â†’ renderer
    onLogLine:          cb => ipcRenderer.on('log-line',            (_, d) => cb(d)),
    onBotStatus:        cb => ipcRenderer.on('bot-status',          (_, d) => cb(d)),
    onBotProgress:      cb => ipcRenderer.on('bot-progress',        (_, d) => cb(d)),
    onNewImage:         cb => ipcRenderer.on('new-image',           (_, d) => cb(d)),
    onAccountUpdate:    cb => ipcRenderer.on('account:update',      (_, d) => cb(d)),
    onLoginStarted:     cb => ipcRenderer.on('account:login-started',(_, d) => cb(d)),
    onSessionUpdate:    cb => ipcRenderer.on('session:stateUpdate', (_, d) => cb(d)),
    onSessionLog:       cb => ipcRenderer.on('session:log',         (_, d) => cb(d)),
});


