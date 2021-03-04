const fs= require('fs');
const Buffer = require('buffer').Buffer;
const torrentParser=require('./metainfoParser');
const config=require('./config');
const torrent = torrentParser.parse(fs.readFileSync(config.TORRENT_PATH));
console.log(torrent);
const tracker=require('./tracker');
const downloader = require('./downloader');
const fileManager = require('./fileManager');
const downloadPath=config.DOWNLOAD_DIR + torrent.md5 + '.mtr';

// if(!fs.existsSync(downloadPath)){
//     fs.writeFileSync(downloadPath, Buffer.alloc(torrent.size),()=>{});
// }else if(fs.readFileSync(downloadPath).length!=torrent.size){
//     fs.writeFileSync(downloadPath, Buffer.alloc(torrent.size),()=>{});
// }

fileManager.init(torrent, (fm) =>{

    downloader.initDownload(torrent, fm);
    tracker.getPeers(torrent,(peers)=>{
        console.log(peers);
        downloader.addPeers(peers);
    })
});


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

