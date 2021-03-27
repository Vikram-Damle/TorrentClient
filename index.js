const fs= require('fs');
const WebSocket=require('ws');

const torrentParser=require('./metainfoParser');
const config=require('./config');
const utils = require('./utils')
const tracker=require('./tracker');
const downloader = require('./downloader');
const fileManager = require('./fileManager');

/* WebSocket server to communicate with the front end UI */
const wss= new WebSocket.Server({port:config.UI_WS_PORT})
/* WebSocket connection with the front end UI */
let ws=null;
/* If metainfo file buffer is expected in the next message */
let expectFile=false;
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
            setInterval(()=>{process.exit();},3000);
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
        utils.log('Client disconnected! Exiting...');
        setInterval(()=>{process.exit();},3000);
    });
})


wss.on('error',(e)=>{
    utils.handleUILaunchError(e);
})

wss.on('listening',()=>{
    /* Launch the UI */
    utils.launchUI();
})


