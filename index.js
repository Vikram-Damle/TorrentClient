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
let torrent = null;

console.log(fs.readFileSync('welcome.txt','ascii'));

wss.on('connection', (connws)=>{
    ws=connws;
    ws.send(JSON.stringify({type:'text',data:fs.readFileSync('welcome.txt','ascii')}));
    ws.send(JSON.stringify({type:'connected',data:'connection successful!'}));
    fileManager.setWs(ws);
    utils.setWs(ws);
    ws.on('message', (msg)=>{
        if(expectFile){
            torrentData=msg;
            expectFile=false;
            return;
        }
        let data = JSON.parse(msg);
        if(data.type == 'torrent-file'){
            expectFile=true;
        }
        if(data.type == 'init'){
            if(!torrentData)return;
            torrent = torrentParser.parse(torrentData);

            fileManager.init(torrent, (fm) =>{
                downloader.initDownload(torrent, fm, ws);
                tracker.getPeers(torrent,(peers)=>{
                    utils.log(peers);
                    downloader.addPeers(peers);
                })
            });
        }
        if(data.type == 'show-dl'){
            utils.openFolder(config.DOWNLOAD_DIR + torrent.filename);
        }
        if(data.type == 'exit'){
            utils.log('Client closed! Exiting...');
            process.exit();
        }
        if(data.type == 'start'){
            fileManager.handelSelection(data.data);
        }
    });
    ws.on('error',(e)=>{
        utils.log('Client closed! Exiting...');
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
-max simultaneous downloads of a piece          X
-cancel pieces if dled                          X
-corrupt file loop                              X
-http tracker support
-peer reconnection
-magnet link support by metadata extension
-input validation for file selection            
*/

