const fs= require('fs');
const Buffer = require('buffer').Buffer;
const torrentParser=require('./metainfoParser');
const config=require('./config');
const utils = require('./utils')
const WebSocket=require('ws');

const tracker=require('./tracker');
const downloader = require('./downloader');
const fileManager = require('./fileManager');

const wss= new WebSocket.Server({port:9494});
let ws=null;
let expectFile=false;
let torrentData=null;

wss.on('connection', (connws)=>{
    ws=connws;
    ws.send(JSON.stringify({type:'connected',data:'connection successful!'}));
    ws.on('message', (msg)=>{
        if(expectFile){
            torrentData=msg;
            expectFile=false;
            return;
        }
        let data = JSON.parse(msg);
        if(data.type == 'torrent-file'){
            expectFile=true;
            ws.send(JSON.stringify({type:'file-ack'}))
        }
        if(data.type == 'init'){
            if(!torrentData)return;
            const torrent = torrentParser.parse(torrentData);
            console.log(torrent);

            fileManager.init(torrent, ws, (fm) =>{
                downloader.initDownload(torrent, fm, ws);
                tracker.getPeers(torrent,(peers)=>{
                    console.log(peers);
                    downloader.addPeers(peers);
                })
            });
        }
        if(data.type == 'show-dl'){
            utils.openFolder(config.DOWNLOAD_DIR);
        }
        if(data.type == 'exit'){
            console.log('Client closed! Exiting...');
            process.exit();
        }
    });
    ws.on('error',(e)=>{
        console.log('Client closed! Exiting...');
        process.exit();
    });
})

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
-max simultaneous downloads of a piece           X
-cancel pieces if dled                          X
-corrupt file loop                              .  blacklisting corrupt pieces
-http tracker support
-peer reconnection
-magnet link support by metadata extension
-input validation for file selection            .  validating input during file selection
*/

