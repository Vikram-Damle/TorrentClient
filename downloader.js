const net = require('net');
const messages = require('./message');
const Bitfield = require('./utils').Bitfield;
const utils = require('./utils');
const crypto=require('crypto');
const config =require('./config');
const chalk = require('chalk');


/* Number of pieces that have been completed */
let completePieces=0;
/* Torrent metainfo object */
var torrent;
/* List of all peers (Peer objects)*/
var peers = new Array();
/* List of all pieces (Piece objects) */
var pieces = new Array();
/* Bitfield of pieces that have been downloaded */
var bitfield;
/* Number of blocks in a complete piece */
var blockPerPiece;
/* The FileManager object; Handles file IO*/
var fileManager;
/* If the global variables have been initialised */
var has_initiated=false;
/* Count of pieces to be downloaded */
var toDlCount=0;
/* WebSocket connection to communicate with UI */
var ws=null;
/* Total DISTINCT blocks that have been downloaded */
var totalBlocksDled=0;
/* Total DISTINCT blocks to download */
var totalBlocks=0;
/* Set of all the peer IPs */
const peerIPs = new Set();


let startTime;
let endTime;

/**
 * Class representing a peer
 */
class Peer{
    constructor(ip,port){
        this.ip=ip;
        this.port=port;
        /* Socket connection with the peer */
        this.socket=null;
        /* If not downloading a piece */
        this.isFree=true;
        /* Index of the piece it is/was downloading */
        this.downloading=-1;
        /* Downloaded block data */
        this.downloadingBlock=null;
        /* Number of blocks completed of piece being downloaded */
        this.completedBlocks=0;
        /* List of pieces that the peer has */
        this.pieces=new Array();
        /* If the peer is choking the client i.e. no piece request can be made */
        this.isChoking=true;
        /*  0: closed connection, 1: open connection  */
        this.status=0;
    }
}

/**
 * Class representing a piece
 */
class Piece{
    constructor(index){
        /*index of the piece in the complete torrent */
        this.index=index;
        /* -1:do not download, 0:none, 1:requested, 2:completed */
        this.state=0;
        /* List of peers that have this piece; used for rarity calculation. */
        this.peers=new Array();
        /* List of peers currently downloading this piece */
        this.currDownloaders=0;
        /* Number of distinct downloaded blocks of this piece  */
        this.maxBlocksDled=0;
    }
}

module.exports.initDownload=(parsedTorrent, fm, connws)=>{
    startTime = Date.now();
    has_initiated=true;
    fileManager=fm;
    torrent=parsedTorrent;
    blockPerPiece = torrent.pieceLength/config.BLOCK_LENGTH;    
    bitfield = fileManager.bitfield;
    ws=connws;

    for(i=0;i<torrent.pieceCount;i++){
        /* Loading all pieces into global list of pieces */
        pieces.push(new Piece(i));

        /* Updating statuses for pieces already present in the downloaded file */
        if(bitfield.get(i) && fileManager.toDl.get(i)){
            pieces[i].state=2;
            completePieces++;
            if(i!=torrent.pieceCount-1)
                totalBlocksDled+=blockPerPiece;
            else{
                totalBlocksDled+=Math.ceil((torrent.size % torrent.pieceLength)/config.BLOCK_LENGTH);
            }
        }

        /* Updating statuses for pieces that are not required for requested files;
           Calculating total blocks that have been downloaded */
        if(!fileManager.toDl.get(i)){
            pieces[i].state=-1;
        }else{
            totalBlocks+=blockPerPiece;
            if(i==torrent.pieceCount-1 && torrent.size%torrent.pieceLength!=0)
                totalBlocks-=Math.floor((torrent.pieceLength - torrent.size%torrent.pieceLength)/config.BLOCK_LENGTH);
        }
    }
    toDlCount=fileManager.toDl.count();
    utils.log(completePieces + 'pieces have been completed!');

}

/**
 * Adds new peers to the downloader
 * @param {Array} peer_conns - Array of peer connections (objects with ip and port properties) 
 */
module.exports.addPeers=(peer_conns)=>{
    if(!has_initiated){
        console.warn("Download has not been initialised. Use initDownload to initialise.");
        return;
    }
    peer_conns.forEach(peer_conn => {
        /*Initiate the peer, it has not been added by some previous tracker response */
        if(!peerIPs.has(peer_conn.ip)) {
            peerIPs.add(peer_conn.ip);
            initiate(peer_conn);
        }
    });
}

/**
 * Initiate the peer connection
 * @param {Object} peer_conn - peer connection details (object with ip and port properties) 
 */
function initiate(peer_conn){
    const peer = new Peer(peer_conn.ip,peer_conn.port);
    peers.push(peer);

    const socket = new net.Socket();

    /* to send interseted message at regular intervals, if choked */
    let interestedInterval=false;
    /* to send keep alive message at regular intervals */
    let keepAliveIntv=false;
    
    connect();

    function connect(){
        utils.log('connecting to '+peer.ip)
        socket.connect(peer.port,peer.ip,()=>{
            peer.socket=socket;
            peer.status=1;
            utils.log(peer.ip+' connected!');
            /*Send the handshake message */
            socket.write(messages.Handshake(torrent));
        });
    }

    /* listener for message from the peer */
    onMessage(socket,(data)=>{
        if(!messages.isHandshake(data))
            handleMessage(messages.parse(data));
        else
            handleHandshake(data);
    }) 
    
    /* Handle the closing of the connection */
    socket.on('close',()=>{
        if(interestedInterval)clearInterval(interestedInterval);
        if(keepAliveIntv)clearInterval(keepAliveIntv);
        utils.log("Connection Closed "+peer.ip);
        /* If the peer was downloading some piece, reset its state */
        if(peer.downloading!=-1){
            let dp=pieces[peer.downloading];
            if(dp.state!=2){
                dp.currDownloaders--;
                dp.state=dp.currDownloaders?1:0;
            }
        }
        peerIPs.delete(peer.ip)
        peer.status=0;
    });

    /*log if error in connection */
    socket.on('error',(error)=>{utils.log(peer.ip ,"ERROR: " + error)});

    /* A connection message may not be a complete protocol message;
    the message listener is wrapped, so protocol messages may be constucted
    over multiple connection messages
    */
    function onMessage(socket, callback){
        /* temp buffer to store segments of protocol messages */
        let buf= Buffer.alloc(0);
        /* the first message is the handshake */
        let handshake = true;
    
        /* for handshake len = len(pstr) + 49 */
        /* for other messages length is stored in first 4 bytes */
        const msgLen=()=>handshake? buf.readUInt8(0) + 49 : buf.readUInt32BE(0) + 4;
    
        socket.on('data', (data)=>{
            buf = Buffer.concat([buf,data]);

            /*while there is a complete protocol message at the beginning of the temp buffer,
            extract and handle the message*/
            while(buf.length>=4 && buf.length>=msgLen()){
                callback(buf.slice(0,msgLen()));
                buf = buf.slice(msgLen());
                /* since only the first message will be a handshake */
                handshake=false;
            }
        })
    }

    /* Handle handshake */
    function handleHandshake(data){
        let msg=messages.parseHandshake(data);

        /* Check if the peer is using the same protocol */
        if(msg.pstr!='BitTorrent protocol'){  
            socket.end(()=>{utils.log(peer.ip +": Protocol Mismatch. Connection closed.");})
        }
        /* Check if the peer is serving the required torrent */
        else if(!msg.infoHash.equals(torrent.infoHash)){
            socket.end(()=>{utils.log(peer.ip +": Info Hash Mismatch. Connection closed.");})
        }
        else{
            /* Send interseted message every 5 seconds until unchoked */
            sendInterested(5000);
            socket.write(messages.Unchoke());
    
            /* Send KeepAlive every 2 minutes */
            keepAlive(60000);
        }
    }

    /* Call appropriate functions for each type of message */
    function handleMessage(msg){
        if(msg.len==0){
            utils.log("Received KEEP ALIVE from "+ peer.ip);
        }
        if(msg.id==0){
            handleChoke(msg);
        }
        else if(msg.id==1){
            handleUnchoke(msg)
        }
        else if(msg.id==2){
            utils.log("Received INTERESTED from "+ peer.ip);
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
        /* Handles null return */
        if(!piece)return;

        /* Set peer and piece status to downloading */
        peer.isFree=false;
        piece.state=1;

        /* Increment number of peers currently sending the piece */
        piece.currDownloaders++;

        /* If this is a completely new piece i.e. not a resumed download of a piece*/
        if(piece.index != peer.downloading){
            peer.downloading = piece.index;

            /* if it is not the last piece */
            if(piece.index != torrent.pieceCount - 1) {
                peer.downloadingBlock = Buffer.alloc(torrent.pieceLength);
            }
            /* the piece length of last piece may be less */
            else {
                peer.downloadingBlock = Buffer.alloc(torrent.size % torrent.pieceLength);
            }

            peer.completedBlocks=0;
        }

        let len=config.BLOCK_LENGTH;
        /* If it is the last block; last block may have length less than typical block length */
        if(piece.index==torrent.pieceCount-1 && (peer.completedBlocks+1)*config.BLOCK_LENGTH > torrent.size%torrent.pieceLength)
            len=torrent.size%config.BLOCK_LENGTH;

        utils.log('requesting piece '+piece.index + ' from ' + peer.ip);
        utils.log('Piece currently being downloaded by: '+ piece.currDownloaders+ ' peer(s)');
        /* Sending the block request */
        socket.write(messages.Request(piece.index,peer.completedBlocks,len));

        /*Subsequent block requests for the piece is made in handleBlock */
    }

    /* Handle block data as response */
    function handleBlock(msg){

        peer.completedBlocks++;

        /* update block download count to update the progress, if the block has not already been downloaded */
        if(peer.completedBlocks > pieces[msg.index].maxBlocksDled){
            totalBlocksDled++;
            pieces[msg.index].maxBlocksDled = peer.completedBlocks;
            ws.send(JSON.stringify({type:'update-progress',
                                    data:{completed: totalBlocksDled, total:totalBlocks}}));
        }

        msg.block.copy(peer.downloadingBlock,msg.begin);
        
        /* If this piece has already been downloaded by some other peer, then move on to new piece*/
        if(pieces[msg.index].state == 2){
            peer.isFree=true;
            peer.downloading=-1;
            pieces[msg.index].currDownloaders--;
            selectAndDownload();
            return;
        }
        
        utils.log(msg.index + ":\t"+ peer.completedBlocks + '\t/\t'  + blockPerPiece +'\t@\t'+peer.ip);
        
        /* check if it is the last block of last piece */
        let lst = (msg.index==torrent.pieceCount-1) 
                && peer.completedBlocks == Math.ceil((torrent.size % torrent.pieceLength)/config.BLOCK_LENGTH);

        
        
        /*If the piece is complete */
        if(peer.completedBlocks==blockPerPiece || lst){
            
            /* generate piece hash */
            let pieceHash=crypto.createHash('sha1').update(peer.downloadingBlock).digest();

            pieces[peer.downloading].currDownloaders--;
            
            /* If the piece hash matches expected hash */
            if(pieceHash.equals(torrent.pieceHash[msg.index]) && pieces[msg.index].state!=2){
                completePieces++;

                utils.log(chalk.bgGreenBright.black('Piece '+msg.index+' completed! from '+peer.ip));
                utils.log(completePieces +'/'+ toDlCount + ' Pieces completed!')
                
                /* Write the piece and update piece state */
                fileManager.writePiece(msg.index, peer.downloadingBlock);
                pieces[msg.index].state=2;

                /* Update bitfield and bitfield file */
                bitfield.set(msg.index);
                fileManager.updateBitfield(bitfield);

            }


            /* Reset Peer status */
            peer.isFree=true;
            peer.downloading=-1;

            /* Check if the download is complete*/
            let complete=true;
            for(i=0;i<torrent.pieceCount;i++){
                if(pieces[i].state!=2 && pieces[i].state!=-1)complete=false;
            }

            /* If complete, handle completion */
            if(complete){
                utils.log("=================================File Downloaded=================================");
                /* notify the UI */
                ws.send(JSON.stringify({type:'finished'}));

                endTime = Date.now();
                utils.log('Time taken: ' + (endTime-startTime)/1000 + ' s');

                /*End the open peer connections */
                peers.forEach((ele)=>{
                    if(ele.status==1)
                        ele.socket.end(()=>{utils.log("Connection Ended " + ele.ip + " : Download complete")});
                })

                /*Parse the files */
                fileManager.parseFiles();
            }
            /* Else download some other piece */
            else{
                selectAndDownload();
            }
        /* Else continue subsequent block request */
        }else{
            let len=config.BLOCK_LENGTH;
            /* last block may have smaller block length */
            if(msg.index==torrent.pieceCount-1 && (peer.completedBlocks+1)*config.BLOCK_LENGTH > torrent.size%torrent.pieceLength)
                len=torrent.size%config.BLOCK_LENGTH;

            socket.write(messages.Request(msg.index,peer.completedBlocks*config.BLOCK_LENGTH,len));
        }
    }

    /* Handle bitfield message; the bitfield represents the pieces that the peer has;
    typically sent just after the handshake */
    function handleBitfield(msg){
        let bf=Bitfield.fromBuffer(msg.bitfield);
        for(i=0;i<torrent.pieceCount;i++){
            if(bf.get(i)){
                pieces[i].peers.push(peer);
                peer.pieces.push(pieces[i]);
                /* If the peer is free, request the piece */
                if(peer.isFree && pieces[i].state==0 && !peer.isChoking){
                    requestPiece(pieces[i]);
                }
            }
        }
    }

    /* Handle have message; one of the pieces that the peer has;
    typically multiple sent just after the handshake */
    function handleHave(msg){
        pieces[msg.pieceIndex].peers.push(peer);
        peer.pieces.push(pieces[msg.pieceIndex]);
        /* If the peer is free, request the piece */
        if(pieces[msg.pieceIndex].state==0 && peer.isFree && !peer.isChoking){
            requestPiece(pieces[msg.pieceIndex]);
        }
    }

    /* Start downloading, when unchoked */
    function handleUnchoke(msg){
        utils.log(peer.ip + " : "+chalk.green("UNCHOKED ^-^"))
        peer.isChoking=false;
        selectAndDownload();
    }

    /* Stop requesting when choked and start sending interested messages */
    function handleChoke(msg){
        utils.log(peer.ip + " : "+chalk.red("CHOKED T-T"));
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
                utils.log("sending interested to "+peer.ip);
            } 
        },interval)
    }

    function keepAlive(interval){
        keepAliveIntv=setInterval(()=>{
            socket.write(messages.KeepAlive());
        },interval);
    }

    /* Select a piece and request */
    function selectAndDownload() {

        if(peer.isChoking || !peer.isFree)return;

        if(peer.downloading==-1 || (peer.downloading!=-1 && pieces[peer.downloading].state==2)){
            /* Try selecting a piece that is not being/ has not been downloaded */
            requestPiece(selectPiece([0]));
            
            /* If not found, the peer will be free. Try selecting piece that has not been downloaded */
            if(peer.isFree){
                requestPiece(selectPiece([0,1]));
            }

            /*If still free, then all pieces that the peer has, have been downloaded. End the connection. */
            if(peer.isFree){
                socket.end(()=>{utils.log("Connection Ended " + peer.ip + " : No downloadable pieces left")});
            }
        }
        /* If peer was downloading a piece, resume the download */
        else requestPiece(pieces[peer.downloading]);
    }

    function selectPiece(dlableStates){
        /* Select piece based on parameter list passed:
          0: download pieces with status 0
          1: download pieces with status 1 */
        let downloadable = new Array();
        for(i=0;i<peer.pieces.length;i++){
            if(dlableStates.includes(peer.pieces[i].state) && peer.pieces[i].currDownloaders < config.MAX_PIECE_SEEDS){
                downloadable.push(peer.pieces[i]);
                // utils.log(chalk.blue(peer.pieces[i].index + ":" +peer.pieces[i].peers.length))
            }
        }

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
