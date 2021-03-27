# Torrent Client #

##### By - Arjun Dey (190123011), Vikram Damle (190123065)

### Instructions:
  - The client may be launched by running `launch_windows.cmd` on windows and `launch_linux` on linux. _The client may also be launched using the command `node index.js` in the project directory._
  - Optional: Set the path to the desired download directory in the config.js file. Default is the `files` subdirectory.
  - Do NOT close the termial window; Use the browser window opened as UI.
  - Select the torrent(metainfo) file to be used.
  - Select the files to be downloaded.
  - Start the download using the `Start` button.
  - Once the download is finished, you can view the files in File Explorer by clicking on the `Show In Folder` button.
  - The client may be exited anytime using the `Exit` button. The completed pieces will be saved and the download may be resumed by running the client again. _(Note: The progress between runs may vary depending on the number of complete pieces downloaded)_
  - **Note:** Only one instance of the client may be run at once.

### Installation:
  - Install `Node.js` runtime from https://nodejs.org/en/. _Skip if already installed._
  - In the project directory, run command `npm install` to install the dependencies.

### References: ###
  - [Unofficial BitTorrent Protocol Specifications](https://wiki.theory.org/BitTorrentSpecification) 
  - [BitTorrent UDP Tracker Protocol Specifications ](http://www.bittorrent.org/beps/bep_0015.html)
  - [Joe Hawes' Blog](https://www.morehawes.co.uk/the-bittorrent-protocol) - providing a high level view of the P2P protocol.
