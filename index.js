const fs= require('fs');
const Buffer = require('buffer').Buffer;
const torrentParser=require('./metainfoParser');
const config=require('./config');
const utils = require('./utils')
const WebSocket=require('ws');

const tracker=require('./tracker');
const downloader = require('./downloader');
const fileManager = require('./fileManager');

/* WebSocket server to communicate with the front end UI */
const wss= new WebSocket.Server({port:9494});
/* WebSocket connection with the front end UI */
let ws=null;
/* If metainfo file buffer is expected in the next message */
let expectFile=false;
/* Raw metainfo file buffer */
let torrentData=null;
/* Parsed metainfo */
let torrent = null;

console.log(fs.readFileSync('welcome.txt','ascii'));

wss.on('connection', (connws)=>{
    ws=connws;
    ws.send(JSON.stringify({type:'text',data:fs.readFileSync('welcome.txt','ascii')}));
    ws.send(JSON.stringify({type:'connected',data:'connection successful!'}));

    /* Assign the websocket connection for the modules */
    utils.setWs(ws);

    ws.on('message', (msg)=>{

        if(expectFile){
            torrent = torrentParser.parse(msg);
            fileManager.printFiles(torrent, ws);
            expectFile=false;
            return;
        }

        let data = JSON.parse(msg);

        if(data.type == 'torrent-file'){
            expectFile=true;
        }

        if(data.type == 'show-dl'){
            /* Show the download in the download directory in file explorer */
            utils.openFolder(config.DOWNLOAD_DIR + torrent.filename);
        }

        if(data.type == 'exit'){
            utils.log('Client closed! Exiting...');
            process.exit();
        }

        if(data.type == 'start'){
            /* Confirm selection and begin the download */
            fileManager.handelSelection(data.data, torrent, (fm) =>{

                /* Initiaize downloader */
                downloader.initDownload(torrent, fm, ws);

                /* Retrieve peers from trackers */
                tracker.getPeers(torrent,(peers)=>{
                    utils.log(peers);
                    downloader.addPeers(peers);
                })
            });
        }
    });

    ws.on('error',(e)=>{
        /* Exit the process if connection with UI is unexpectedly broken */
        utils.log('Client closed! Exiting...');
        process.exit();
    });
})

/* Launch the UI */
utils.launchUI();

/* ToDo:
-File parsing after download                    X
-bitfield file validation                       X
-piece validation                               X                       
-Selective file download                        X
-save file selection
-nested directories                             X
-remove temp files                              X
-end game                                       .
-last piece block                               X
-peer protocol validation                       X
-max simultaneous downloads of a piece          X
-cancel pieces if dled                          X
-corrupt file loop                              X
-http tracker support
-peer reconnection
-magnet link support by metadata extension
-input validation for file selection            
*/

