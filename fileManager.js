const Bitfield = require('./utils').Bitfield;
const fs = require('fs');
const utils = require('./utils');
const config = require('./config');


class FileManager{

    constructor(torrent, toDl, bfFile, bf, fileToWrite, filesToDl, paths, fileDescriptors){
        this.torrent = torrent;
        this.toDl = toDl;
        this.bfFile = bfFile;
        this.bitfield = bf;
        this.fileToWrite = fileToWrite;
        this.filesToDl = filesToDl;
        this.paths = paths;
        this.fileDescriptors = fileDescriptors;
    }

    writePiece(piece,pieceData){
        if(!this.toDl.get(piece))return null;

        const files = this.fileToWrite[piece];
        files.forEach((file) => {
            let offset=0;
            for(let i=0; i<piece; i++){
                if(this.fileToWrite[i] && this.fileToWrite[i].includes(file))
                    offset+=this.torrent.pieceLength;
            }
            fs.writeSync(file,pieceData,0,pieceData.length,offset);

        })
      
    };
    
    updateBitfield(bitfield){
        fs.writeSync(this.bfFile,bitfield.buffer,0,bitfield.buffer.length,0);
    };

    parseFiles(){
        utils.log("Parsing the files...");
        if(!this.torrent.files){
            let data=Buffer.alloc(this.torrent.size);
            fs.readSync(this.fileToWrite[0][0],data,0,data.length,0);
            fs.writeFileSync(config.DOWNLOAD_DIR + this.torrent.filename, data);
        }
        else{
            let prefSize = 0;
            this.torrent.files.forEach((file,ind)=>{
                if(this.filesToDl.get(ind)){
                    let startPiece = Math.floor(prefSize/torrent.pieceLength);
                    let data = Buffer.alloc(file.size);
                    let offset=0;
                    for(let i=0; i<startPiece; i++){
                        if(this.fileToWrite[i] && this.fileToWrite[i].includes(this.fileDescriptors[file.path]))
                        offset+=this.torrent.pieceLength;
                    }
                    offset+=prefSize%torrent.pieceLength;
                    fs.readSync(this.fileDescriptors[file.path], data, 0, data.length, offset);
                    createSubDirs(config.DOWNLOAD_DIR + torrent.filename + '/' + file.path);
                    fs.writeFileSync(config.DOWNLOAD_DIR + torrent.filename + '/' + file.path, data);
                }
                prefSize+=file.size;
            });
        }
        
        utils.log("removing temp files...");
        let fds=new Set();
        for (const [piece, fd] of Object.entries(this.fileDescriptors)) {
            fds.add(fd);
        }
        fds.forEach((fd)=>{
            fs.closeSync(fd);
        });
        fs.closeSync(this.bfFile);
        this.paths.forEach((path,ind)=>{
            utils.log('Deleting '+path);
            fs.unlinkSync(path);
        })
        utils.log("Finished!");
    };
};

var files = new Array();
var torrent;
var toDl;
var bfFile;
var bitfield;
var fileToWrite = new Object();
var fileDescriptors = new Object();
var paths = new Array();
var ws;
var callback;

module.exports.init = (torrentToDl, cb)=>{
    torrent = torrentToDl;
    printFiles(torrent);
    callback=cb;
}

module.exports.setWs = (websocket)=>{
    ws=websocket;
}


/** 
 * Declare an array to store the file references.
 * Create and/or open files here and store them in the array.
 * Piece-Descriptor relations are stored in fileToWrite.
 * File-Descriptor relations are stored in fileDescriptors.
 */
function createFiles(fileBitField){
    let dir=config.DOWNLOAD_DIR;
    if(torrent.files){
        dir = dir + torrent.filename + '/'; 
        if (!fs.existsSync(dir)){
            fs.mkdirSync(dir);
        }

        prevSum = [0];
        torrent.files.forEach((file, index) => {
            prevSum[index+1] = prevSum[index] + file.size;
            const path = dir + torrent.md5 + '_' + index + '.mtr';

            if(!fileBitField.get(index)) {
                if(fs.existsSync(path)) {
                    fs.unlinkSync(path)
                }
                return;
            }
            
            if(!fs.existsSync(path)) {
                fs.writeFileSync(path, Buffer.alloc(file.size));
            }
            const t = openOverwrite(path);
            paths.push(path);
            fileDescriptors[file.path] = t;
            
            const begin = Math.floor(prevSum[index] / torrent.pieceLength);
            const end = 1 + Math.floor((prevSum[index] + file.size) / torrent.pieceLength);
            for(let i = begin; i <= end; i++) {
                if(fileToWrite[i] && fileToWrite[i].length > 0) {
                    fileToWrite[i].push(t);
                } else {
                    fileToWrite[i] = [t];
                }
            }

        })
    }
    else{
        let path = dir + torrent.md5 + '.mtr';
        if(!fs.existsSync(path))
            fs.writeFileSync(path, Buffer.alloc(torrent.size));
        let t=openOverwrite(path);
        paths.push(path);
        for(let k=0; k<torrent.pieceCount; k++){
            fileToWrite[k]=[t];
        }
    }

};

function createBitfieldFile(){
    let bitfieldPath = config.DOWNLOAD_DIR;
    if(torrent.files){
        bitfieldPath = bitfieldPath + torrent.filename + '/';
        if(!fs.existsSync(bitfieldPath)){
            fs.mkdirSync(bitfieldPath);
        }
    }
    
    bitfieldPath = bitfieldPath + torrent.md5 + '.bfd'

    if(fs.existsSync(bitfieldPath)){
        bitfield= Bitfield.fromBuffer(fs.readFileSync(bitfieldPath),torrent.pieceCount);
    }else{
        bitfield= new Bitfield(torrent.pieceCount);
        fs.writeFileSync(bitfieldPath,bitfield.buffer);
    }

    bfFile=openOverwrite(bitfieldPath);
    paths.push(bitfieldPath);
}


/** 
 * Creates new file and copies all data of the old file into it.
 * Only called once existence of the file has been verified.
 */
function openOverwrite(path){
    let oldData=fs.readFileSync(path);
    let fd=fs.openSync(path, 'w+'); 
    fs.writeSync(fd,oldData);
    return fd;
}

function createSubDirs(path){
    let dir = path.split('/');
    dir.pop();
    if(dir.length){
        dir=dir.join('/');
        fs.mkdirSync(dir,{recursive:true});
    }
}

function printFiles(torrent){
    let filedets = [];
    if(torrent.files){
        let mxNameLen=0;
        torrent.files.forEach((ele=>{mxNameLen=Math.max(mxNameLen,ele.path.length);}));
        mxNameLen = Math.ceil(mxNameLen/8)*8;
        torrent.files.forEach((ele,ind) => {
            let name = (ind+1) + '. ' + ele.path;
            /* adding appropriate padding */
            let padding='';
            for(var i=0;i<Math.ceil((mxNameLen-name.length)/8);i++)padding+='\t';
            filedets.push({name:ele.path,size:(ele.size/1048576).toFixed(2) + 'MB'});
        });
    }
    else{
        filedets.push({name:torrent.filename,size:(torrent.size/1048576).toFixed(2) + 'MB'})
    }
    ws.send(JSON.stringify({type:'file-list',data:filedets}));
}

module.exports.handelSelection = function handleSelection(inp){
    createBitfieldFile();
    if(torrent.files){
        let sel;
        if(inp=='*') sel = Array.from({length: torrent.files.length}, (_, i) => i + 1);
        else sel = inp.trim().split(' ').map((ele)=>parseInt(ele));
        let prefSum = new Array();
        prefSum.push(0);
        torrent.files.forEach((ele,ind)=>{
            prefSum[ind+1]=prefSum[ind] + ele.size;
        })
        toDl= new Set();
        sel.forEach((ele)=>{
            let beg = Math.floor(prefSum[ele-1]/torrent.pieceLength);
            let end = Math.floor((prefSum[ele-1]+torrent.files[ele-1].size)/torrent.pieceLength);
            for( var i = beg; i<=end; i++)toDl.add(i+1);
        })
        let bf = Bitfield.fromArray(toDl,torrent.pieceCount);
        /* BitField of all files to be downloaded. Use to find index of file in list of all files. */
        let filesToDl = Bitfield.fromArray(sel,torrent.files.length);
        toDl=bf;
        createFiles(filesToDl); 
        let fm = new FileManager(torrent, toDl, bfFile, bitfield, fileToWrite, filesToDl, paths, fileDescriptors);
        utils.log("temp files created...");
        callback(fm);
    }else{
        toDl = new Bitfield(torrent.pieceCount);
        for(let i=0; i < toDl.length; i++)toDl.set(i);
        const filesToDl = Bitfield.fromArray([1], 1);
        createFiles(filesToDl);
        let fm = new FileManager(torrent, toDl, bfFile, bitfield, fileToWrite, null, paths, fileDescriptors);
        callback(fm);
    }
}