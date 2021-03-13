const net = require('net');
const messages = require('./message');
const Bitfield = require('./utils').Bitfield;
const crypto=require('crypto');
const config =require('./config');
const cliProgress = require('cli-progress');
const chalk = require('chalk');



let completePieces=0;
var torrent;
var peers;
var pieces;
var bitfield;
var blockPerPiece;
var fileManager;
var has_initiated=false;
var toDlCount=0;
var ws=null;
var totalBlocksDled=0;
var totalBlocks=0;
const LOG_MODE=0;

let start;
let end;

class Peer{
    constructor(ip,port){
        this.ip=ip;
        this.port=port;
        this.socket=null;
        this.isFree=true;
        this.downloading=-1;
        this.downloadingBlock=null;
        this.completedBlocks=0;
        this.pieces=new Array();
        this.isChoking=true;
        this.corruptPieces= new Array();
        this.status=0;
    }
}

class Piece{
    constructor(index){
        //-1:doNotDownload, 0:none, 1:requested, 2:completed
        this.index=index;
        this.state=0;
        this.peers=new Array();
        this.downloaders=0;
        this.progress=null;
        this.currDownloaders=0;
        this.maxBlocksDled=0;
    }
}

module.exports.initDownload=(parsedTorrent, fm, connws)=>{
    start = Date.now();
    has_initiated=true;
    fileManager=fm;
    torrent=parsedTorrent;
    pieces=new Array();
    peers = new Array();
    blockPerPiece = torrent.pieceLength/config.BLOCK_LENGTH;    
    bitfield = fileManager.bitfield;
    ws=connws;

    for(i=0;i<torrent.pieceCount;i++){
        /* Loading all pieces into global list of pieces */
        pieces.push(new Piece(i));

        /* Updating statuses for pieces already present in the downloaded file */
        if(bitfield.get(i)){
            pieces[i].state=2;
            completePieces++;
            totalBlocksDled+=blockPerPiece;
        }

        /* Updating statuses for pieces that are not required for requested files*/
        if(!fileManager.toDl.get(i)){
            pieces[i].state=-1;
        }else{
            totalBlocks+=blockPerPiece;
            if(i==torrent.pieceCount-1 && torrent.size%torrent.pieceLength!=0)
                totalBlocks-=Math.floor((torrent.pieceLength - torrent.size%torrent.pieceLength)/config.BLOCK_LENGTH);
        }
    }
    toDlCount=fileManager.toDl.count();
    log(completePieces + 'pieces have been completed!');
    //bitfield.print();

}

module.exports.addPeers=(peer_conns)=>{
    if(!has_initiated){
        console.warn("Download has not been initialised. Use initDownload to initialise.");
        return;
    }
    peer_conns.forEach(peer_conn => {
        initiate(peer_conn);
    });
}

function initiate(peer_conn){
    const peer = new Peer(peer_conn.ip,peer_conn.port);
    peers.push(peer);

    /* Initially setting all pieces as uncorrupted pieces*/
    // Might need to find a better place for this

    const socket = new net.Socket();


    let interestedInterval=false;
    let keepAliveIntv=false;
    let connTimeout= false;
    
    connect();

    function connect(){
        log('connecting to '+peer.ip)
        socket.connect(peer.port,peer.ip,()=>{
            peer.socket=socket;
            peer.status=1;
            log(peer.ip+' connected!');
            socket.write(messages.Handshake(torrent));
        });
    }

    onMessage(socket,(data)=>{
        if(!messages.isHandshake(data))
            handleMessage(messages.parse(data));
        else
            handleHandshake(data);
    }) 
    
    socket.on('close',()=>{
        if(interestedInterval)clearInterval(interestedInterval);
        if(keepAliveIntv)clearInterval(keepAliveIntv);
        log("Connection Closed "+peer.ip);
        if(peer.downloading!=-1){
            let dp=pieces[peer.downloading];
            dp.state=0;
        }
        //connTimeout=setTimeout(connect,5000);
        peer.status=0;
    });

    socket.on('error',(error)=>{log(peer.ip ,"ERROR: " + error)});

    function onMessage(socket, callback){
        let buf= Buffer.alloc(0);
        let handshake = true;
    
        //for handshake len = len(pstr) + 49
        //for other messages length is stored in first 4 bytes
        const msgLen=()=>handshake? buf.readUInt8(0) + 49 : buf.readUInt32BE(0) + 4;
    
        socket.on('data', (data)=>{
            buf = Buffer.concat([buf,data])
            while(buf.length>=4 && buf.length>=msgLen()){
                callback(buf.slice(0,msgLen()));
                buf = buf.slice(msgLen());
                //since only the first message will be a handshake
                handshake=false;
            }
        })
    }

    function handleHandshake(data){
        log("Recieved Handshake!");
        let msg=messages.parseHandshake(data);
        log(msg);
        if(msg.pstr!='BitTorrent protocol'){  
            socket.end(()=>{log(peer.ip +": Protocol Mismatch. Connection closed.");})
        }
        else if(!msg.infoHash.equals(torrent.infoHash)){
            socket.end(()=>{log(peer.ip +": Info Hash Mismatch. Connection closed.");})
        }
        else{
            sendInterested(5000);
            socket.write(messages.Unchoke());
            //socket.write(messages.Bitfield(bitfield.buffer))
    
            //Send KeepAlive every 2 minutes
            keepAlive(60000);
        }
    }

    function handleMessage(msg){
        if(msg.len==0){
            log("Received KEEP ALIVE from "+ peer.ip);
        }
        if(msg.id==0){
            handleChoke(msg);
        }
        else if(msg.id==1){
            handleUnchoke(msg)
        }
        else if(msg.id==2){
            log("Received INTERESTED from "+ peer.ip);
            socket.write(messages.Unchoke());
        }
        else if(msg.id==4){
            handleHave(msg);
        }
        else if(msg.id==5){
            handleBitfield(msg);
        }
        else if(msg.id==7){
            handleBlock(msg);
        }
    }


    function requestPiece(piece){
        // if(piece.index>1)return;
        // piece.progress = new cliProgress.SingleBar({}, cliProgress.Presets.shades_classic);
        // piece.progress.start(blockPerPiece,0);

        /* Handles null return */
        if(!piece)return;
        /* Set peer and piece status to downloading */
        peer.isFree=false;
        piece.state=1;
        let blockSize=config.BLOCK_LENGTH;
        /* Increment number of peers currently sending the piece */
        piece.currDownloaders++;
        /* If this is a completely new piece */
        if(piece.index != peer.downloading){
            peer.downloading = piece.index;

            /* and it is not the last piece */
            if(piece.index != torrent.pieceCount - 1) {
                peer.downloadingBlock = Buffer.alloc(torrent.pieceLength);
            }
            else {
                peer.downloadingBlock = Buffer.alloc(torrent.size % torrent.pieceLength);
            }

            peer.completedBlocks=0;
        }

        let len=config.BLOCK_LENGTH;
        /* If it is the last block */
        if(piece.index==torrent.pieceCount-1 && (peer.completedBlocks+1)*config.BLOCK_LENGTH > torrent.size%torrent.pieceLength)
            len=torrent.size%config.BLOCK_LENGTH;

        log('requesting piece '+piece.index + ' from ' + peer.ip);
        log('Piece currently being downloaded by: '+ piece.currDownloaders+ ' peer(s)');
        socket.write(messages.Request(piece.index,peer.completedBlocks,len));
    }

    function handleBlock(msg){
        peer.completedBlocks++;
        if(peer.completedBlocks > pieces[msg.index].maxBlocksDled){
            totalBlocksDled++;
            pieces[msg.index].maxBlocksDled = peer.completedBlocks;
            ws.send(JSON.stringify({type:'update-progress',
                                    data:{completed: totalBlocksDled, total:totalBlocks}}));
        }
        log(msg.index + ":\t"+ peer.completedBlocks + '\t/\t'  + blockPerPiece +'\t@\t'+peer.ip);
        //pieces[msg.index].progress.update(peer.completedBlocks);
        msg.block.copy(peer.downloadingBlock,msg.begin);

        /* If this piece has already been downloaded by some other peer, then move on to new piece*/
        if(pieces[msg.index].state == 2){
            peer.isFree=true;
            peer.downloading=-1;
            selectAndDownload();
            return;
        }

        /* check if it is the last block of last piece */
        let lst = (msg.index==torrent.pieceCount-1) 
                && peer.completedBlocks == Math.ceil((torrent.size % torrent.pieceLength)/config.BLOCK_LENGTH);

        if(peer.completedBlocks==blockPerPiece || lst){
            
            /* generate piece hash */
            let pieceHash=crypto.createHash('sha1').update(peer.downloadingBlock).digest();
            log(pieceHash);
            log(torrent.pieceHash[msg.index]);
            pieces[peer.downloading].currDownloaders--;
            
            /* If the piece hash matches expected hash */
            if(pieceHash.equals(torrent.pieceHash[msg.index]) && pieces[msg.index].state!=2){
                completePieces++;
                log(chalk.bgGreenBright.black('Piece '+msg.index+' completed! from '+peer.ip));
                log(completePieces +'/'+ toDlCount + ' Pieces completed!')

                /* Mark the piece as uncorrupted (useful if piece was marked as corrupted, no-op if piece wasn't) */
                // peer.corruptPieces[msg.index] = 0;

                fileManager.writePiece(msg.index, peer.downloadingBlock);
                pieces[msg.index].state=2;

                bitfield.set(msg.index);
                fileManager.updateBitfield(bitfield);

            } else {
                /* Flag piece as corrupted */
                peer.pieces.splice(peer.pieces.findIndex(e=>e.index==msg.index),1);
                peer.corruptPieces.push(pieces[msg.index]);
            }

            //bitfield.print();

            /* Reset Peer status */
            peer.isFree=true;
            peer.downloading=-1;


            // for(i=0;i<peer.pieces.length;i++){
            //     //log(peer.pieces[i].state==0,!peer.isChoking,peer.isFree);
            //     if(peer.pieces[i].state==0 && !peer.isChoking && peer.isFree){
            //         requestPiece(peer.pieces[i]);
            //     }
            // }
            // for(i=0;i<peers.length;i++){
            //     if(peers[i].socket)peers[i].socket.write(messages.Have(msg.index));
            // }


            /* Check if the download is complete*/
            let complete=true;
            for(i=0;i<torrent.pieceCount;i++){
                if(pieces[i].state!=2 && pieces[i].state!=-1)complete=false;
            }
            if(complete){
                log("=============================File Downloaded=================================");
                ws.send(JSON.stringify({type:'finished'}));
                end = Date.now();
                log('Time taken: ' + end-start + ' ms');
                fileManager.parseFiles();
                peers.forEach((ele)=>{
                    if(ele.status==1)ele.socket.end(()=>{log("Connection Ended " + peer.ip + " : Download complete")});
                    
                })
                for(i=0;i<torrent.pieceCount;i++){
                    if(pieces[i].state==2)console.log(pieces[i].maxBlocksDled);
                }
                console.log(totalBlocksDled, totalBlocks);
                //process.exit();
            }else{
                /* Get new piece */
                selectAndDownload();
            }

        }else{
            let len=config.BLOCK_LENGTH;
            if(msg.index==torrent.pieceCount-1 && (peer.completedBlocks+1)*config.BLOCK_LENGTH > torrent.size%torrent.pieceLength)
                len=torrent.size%config.BLOCK_LENGTH;

            socket.write(messages.Request(msg.index,peer.completedBlocks*config.BLOCK_LENGTH,len));
        }
    }

    function handleBitfield(msg){
        let bf=Bitfield.fromBuffer(msg.bitfield);
        for(i=0;i<torrent.pieceCount;i++){
            if(bf.get(i)){
                pieces[i].peers.push(peer);
                peer.pieces.push(pieces[i]);
                if(peer.isFree && pieces[i].state==0 && !peer.isChoking){
                    requestPiece(pieces[i]);
                }
            }
        }
    }

    function handleHave(msg){
        pieces[msg.pieceIndex].peers.push(peer);
        peer.pieces.push(pieces[msg.pieceIndex]);
        if(pieces[msg.pieceIndex].state==0 && peer.isFree && !peer.isChoking){
            requestPiece(pieces[msg.pieceIndex]);
        }
    }

    function handleUnchoke(msg){
        log(peer.ip + " : "+chalk.green("UNCHOKED ^-^"))
        peer.isChoking=false;
        // log(peer.downloading);
        selectAndDownload();
    }

    function handleChoke(msg){
        log(peer.ip + " : "+chalk.red("CHOKED T-T"));
        peer.isChoking=true;
        if(peer.downloading > -1) {
            pieces[peer.downloading].currDownloaders--;
        }
        if(!interestedInterval)sendInterested(5000);
    }

    function sendInterested(interval){
        interestedInterval=setInterval(()=>{
            if(!peer.isChoking){
                clearInterval(interestedInterval);
                interestedInterval=false;
            }
            else{
                socket.write(messages.Interested());
                log("sending interested to "+peer.ip);
            } 
        },interval)
    }

    function keepAlive(interval){
        keepAliveIntv=setInterval(()=>{
            socket.write(messages.KeepAlive());
        },interval);
    }

    function selectAndDownload() {
        /**
         * Select request strategy (normal vs end game)
         * Try looking for an available piece that's not being downloaded.
         * If all are currently being downloaded by someone, enter endgame mode.
         * If all are currently downloaded, end connection
         */
        if(peer.isChoking || !peer.isFree)return;

        if(peer.downloading==-1){
            
            requestPiece(selectPiece([0]));
            
            if(peer.isFree){
                requestPiece(selectPiece([0,1]));
            }
            if(peer.isFree){
                socket.end(()=>{log("Connection Ended " + peer.ip + " : No downloadable pieces left")});
            }
        }
        else requestPiece(pieces[peer.downloading]);
    }

    function selectPiece(dlableStates){
        /**
         * Select piece based on parameter list passed:
         * 0: download pieces with status 0
         * 1: download pieces with status 1
         * 
         * If none are available, the try downloading the oldest corrupt piece. -- to be implemented
         */
        let downloadable = new Array();
        for(i=0;i<peer.pieces.length;i++){
            if(dlableStates.includes(peer.pieces[i].state) && peer.pieces[i].currDownloaders < config.MAX_PIECE_SEEDS){
                downloadable.push(peer.pieces[i]);
                log(chalk.blue(peer.pieces[i].index + ":" +peer.pieces[i].peers.length))
            }
        }
        /**
         * If any non-corrupt pieces matched the allowed state criteria then return the rarest piece
         * Else if return the oldest corrupt piece
         * Else return null
         */
        if(downloadable.length){
            let rarest = downloadable.reduce(function(prev,curr){
                return prev.peers.length < curr.peers.length ? prev : curr;
            })
            return rarest;
        } else if(dlableStates.length === 2) {
            for(i=0;i<peer.pieces.length;i++){
                if(dlableStates.includes(peer.pieces[i].state) && peer.pieces[i].currDownloaders < config.MAX_PIECE_SEEDS)
                    return peer.pieces[i]
            }
            return null
        } else return null;
    }

}

function log(text,mode=LOG_MODE){
    if(mode==0||mode==2)console.log(text);
    if(mode==1||mode==2)ws.send(JSON.stringify({type:'text',data:text}));
}