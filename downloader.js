const net = require('net');
const messages = require('./message');
const Bitfield = require('./utils').Bitfield;
const crypto=require('crypto');
const config =require('./config');
const cliProgress = require('cli-progress');
const chalk = require('chalk');
const performance = require('perf_hooks')



let completePieces=0;
var torrent;
var peers;
var pieces;
var bitfield;
var blockPerPiece;
var fileManager;
var has_initiated=false;
var toDlCount=0;

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
    }
}

module.exports.initDownload=(parsedTorrent, fm)=>{
    start = Date.now();
    has_initiated=true;
    fileManager=fm;
    torrent=parsedTorrent;
    pieces=new Array();
    peers = new Array();
    blockPerPiece = torrent.pieceLength/config.BLOCKLENGTH;
    bitfield = fileManager.bitfield;

    for(i=0;i<torrent.pieceCount;i++){
        pieces.push(new Piece(i));
        if(bitfield.get(i)){
            pieces[i].state=2;
            completePieces++;
        }
        if(!fileManager.toDl.get(i)){
            pieces[i].state=-1;
        }
    }
    toDlCount=fileManager.toDl.count();
    console.log(completePieces + 'pieces have been completed!');
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
    const socket = new net.Socket();


    let interestedInterval=false;
    let keepAliveIntv=false;
    let connTimeout= false;
    
    connect();

    function connect(){
        console.log('connecting to '+peer.ip)
        socket.connect(peer.port,peer.ip,()=>{
            peer.socket=socket;
            console.log(peer.ip+' connected!');
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
        console.log(peer.ip + " closed the connection...Was downloading piece: " + peer.downloading);
        if(peer.downloading!=-1){
            let dp=peer.pieces[peer.downloading];
            dp.state=0;
        }
        //connTimeout=setTimeout(connect,5000);

    });

    socket.on('error',(error)=>{console.log(peer.ip ,"ERROR: " + error)});

    function onMessage(socket, callback){
        let buf= Buffer.alloc(0);
        let handshake = true;
    
        //for handshake len = len(pstr) + 49
        //for other messages length is stores in first 4 bytes
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
        console.log("Recieved Handshake!");
        let msg=messages.parseHandshake(data);
        console.log(msg);
        if(msg.pstr!='BitTorrent protocol'){  
            socket.end(()=>{console.log(peer.ip +": Protocol Mismatch. Connection closed.");})
        }
        else if(!msg.infoHash.equals(torrent.infoHash)){
            socket.end(()=>{console.log(peer.ip +": Info Hash Mismatch. Connection closed.");})
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
            console.log("Received KEEP ALIVE from "+ peer.ip);
        }
        if(msg.id==0){
            handleChoke(msg);
        }
        else if(msg.id==1){
            handleUnchoke(msg)
        }
        else if(msg.id==2){
            console.log("Received INTERESTED from "+ peer.ip);
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
        if(!piece)return;
        peer.isFree=false;
        piece.state=1;
        let blockSize=config.BLOCKLENGTH;
        piece.currDownloaders++;
        if(piece.index != peer.downloading){
            peer.downloading = piece.index;
            if(piece.index != torrent.pieceCount - 1)
                peer.downloadingBlock = Buffer.alloc(torrent.pieceLength);
            else
                peer.downloadingBlock = Buffer.alloc(torrent.size % torrent.pieceLength);
            peer.completedBlocks=0;
        }

        let len=config.BLOCKLENGTH;
        //If it is the last block
        if(piece.index==torrent.pieceCount-1 && (peer.completedBlocks+1)*config.BLOCKLENGTH > torrent.size%torrent.pieceLength)
            len=torrent.size%config.BLOCKLENGTH;

        console.log('requesting piece '+piece.index + ' from ' + peer.ip);
        console.log('Piece currently being downloaded by: ', piece.currDownloaders, ' peer(s)');
        socket.write(messages.Request(piece.index,peer.completedBlocks,len));
    }

    function handleBlock(msg){
        // TODO: Decrement on last block recieve.
        peer.completedBlocks++;
        console.log(msg.index + ":\t"+ peer.completedBlocks + '\t/\t'  + blockPerPiece +'\t@\t'+peer.ip);
        //pieces[msg.index].progress.update(peer.completedBlocks);
        msg.block.copy(peer.downloadingBlock,msg.begin);

        if(pieces[msg.index].state == 2){
            peer.isFree=true;
            peer.downloading=-1;
            selectAndDownload();
        }

        //check if it is the last block of last piece
        let lst = (msg.index==torrent.pieceCount-1) 
                && peer.completedBlocks == Math.ceil((torrent.size % torrent.pieceLength)/config.BLOCKLENGTH);

        if(peer.completedBlocks==blockPerPiece || lst){
            
            let pieceHash=crypto.createHash('sha1').update(peer.downloadingBlock).digest();
            console.log(pieceHash);
            console.log(torrent.pieceHash[msg.index]);
            
            
            if(pieceHash.equals(torrent.pieceHash[msg.index]) && pieces[msg.index].state!=2){
                completePieces++;
                pieces[peer.downloading].currDownloaders--;
                console.log(chalk.bgGreenBright.black('Piece '+msg.index+' completed! from '+peer.ip));
                console.log(completePieces +'/'+ toDlCount + ' Pieces completed!')

                fileManager.writePiece(msg.index, peer.downloadingBlock);
                pieces[msg.index].state=2;

                bitfield.set(msg.index);
                fileManager.updateBitfield(bitfield);

            }

            //bitfield.print();
            peer.isFree=true;
            peer.downloading=-1;


            // for(i=0;i<peer.pieces.length;i++){
            //     //console.log(peer.pieces[i].state==0,!peer.isChoking,peer.isFree);
            //     if(peer.pieces[i].state==0 && !peer.isChoking && peer.isFree){
            //         requestPiece(peer.pieces[i]);
            //     }
            // }
            // for(i=0;i<peers.length;i++){
            //     if(peers[i].socket)peers[i].socket.write(messages.Have(msg.index));
            // }
            selectAndDownload();

            let complete=true;
            for(i=0;i<torrent.pieceCount;i++){
                if(pieces[i].state!=2 && pieces[i].state!=-1)complete=false;
            }
            if(complete){
                console.log("=============================File Downloaded=================================");
                end = Date.now();
                console.log(end-start);
                fileManager.parseFiles();
                process.exit();
            }

        }else{
            let len=config.BLOCKLENGTH;
            if(msg.index==torrent.pieceCount-1 && (peer.completedBlocks+1)*config.BLOCKLENGTH > torrent.size%torrent.pieceLength)
                len=torrent.size%config.BLOCKLENGTH;

            socket.write(messages.Request(msg.index,peer.completedBlocks*config.BLOCKLENGTH,len));
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
        console.log(peer.ip + " : "+chalk.green("UNCHOKED ^-^"))
        peer.isChoking=false;
        // console.log(peer.downloading);
        selectAndDownload();
    }

    function handleChoke(msg){
        console.log(peer.ip + " : "+chalk.red("CHOKED T-T"));
        peer.isChoking=true;
        // TODO: Check downloading property, check piece being downloaded and decrement
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
                console.log("sending interested to "+peer.ip);
            } 
        },interval)
    }

    function keepAlive(interval){
        keepAliveIntv=setInterval(()=>{
            socket.write(messages.KeepAlive());
        },interval);
    }

    function selectAndDownload(){
        if(peer.isChoking || !peer.isFree)return;

        if(peer.downloading==-1){
            
            requestPiece(selectPiece([0]));
            
            if(peer.isFree){
                requestPiece(selectPiece([0,1]));
            }
            if(peer.isFree){
                socket.end(()=>{console.log("Ended connection " + peer.ip + " : No downloadable pieces left")})
            }
        }
        else if(peer.pieces[peer.downloading])
            requestPiece(pieces[peer.downloading]);
    }

    function selectPiece(dlableStates){
        let downloadable = new Array();
        for(i=0;i<peer.pieces.length;i++){
            if(dlableStates.includes(peer.pieces[i].state) && peer.pieces[i].currDownloaders < config.MAXUPLOADERS){
                downloadable.push(peer.pieces[i]);
                console.log(chalk.blue(peer.pieces[i].index + ":" +peer.pieces[i].peers.length))
            }
        }
        if(downloadable.length){
            let rarest = downloadable.reduce(function(prev,curr){
                return prev.peers.length < curr.peers.length ? prev : curr;
            })
            return rarest;
        }
        else return null;
    }
}
