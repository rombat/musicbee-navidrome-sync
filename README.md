# MusicBee to Navidrome Sync (MBNDS)

<a href="https://github.com/rombat/musicbee-navidrome-sync/blob/master/LICENCE"><img src="https://img.shields.io/github/license/rombat/musicbee-navidrome-sync?color=green" /></a>
<a href="https://github.com/rombat/musicbee-navidrome-sync/releases/latest"><img src="https://img.shields.io/github/v/release/rombat/musicbee-navidrome-sync?include_prereleases?color=blue" /></a>
<a href="https://github.com/rombat/musicbee-navidrome-sync/releases"><img src="https://img.shields.io/github/downloads/rombat/musicbee-navidrome-sync/total?color=orange" /></a>


## 🎶 Preamble

I've been using [MusicBee](https://www.getmusicbee.com/) for more than a decade. That means years of playcounts, ratings, loved tracks and so on.  
When I set up myself a [Navidrome](https://www.navidrome.org/) server, I didn't want to lose all those years of data, so I decided to do something to import them. 
And I actually still use MusicBee, I only use Navidrome when I'm not home, so I wanted to be able to sync my local ratings/playcounts etc. from time to time. 
Hence this project. It's probably a niche use case, but who knows, it can be useful to somebody?  



## 🤔 Purpose

MusicBee to Navidrome Sync allows you to:
* import MB tracks playcount, ratings, loved tracks, last played date. You can add them to already existing ND data (for a first time sync), or update them occasionally if needed.
* update ND albums/artists playcount and last played date, and generate or update their ratings based only on ND data (see [Notes](#-notes));


## ❔ How to use it

1. First, you need MusicBee 3.5 with its language set as **English** and [Additional Tagging & Reporting Tools](https://getmusicbee.com/addons/plugins/49/additional-tagging-amp-reporting-tools/) plugin installed
2. Once it's done, select **Music** under the Collection menu. Then click on **MusicBee** > **Tools** > **Additional Tagging Tools** > **Library Report**... to export library data  in a CSV
3. Click **New Preset** to create a new preset, and give it a name by just by typing anything in the field where **(Auto preset name)** is displayed
4. You can now add data to your export, by clicking on **Add** (**Function** select needs to be `<Grouping>`). Here, you have to select tags that will be exported as headers for your CSV. You need to select **at least** the following ones for MBNDS to work properly:
    * `<File Path>`
    * `<Filename>`
    * `<Folder>`
    * `Title`
    * `Last Played`
    * `Play Count`
    * `Rating`
    * `Love`
    * `Skip Count`
5. If the checkbox is available, you can tick **Hide preview**, it'll scan your library faster
6. Click on **Preview**, MusicBee will scan your entire collection, so it can take some time depending on its size. Once it's done, select `CSV` in **Format** (if necessary), click on **Export** and name your file `MusicBee_Export.csv`
7. **Shutdown Navidrome properly**. This is mandatory to avoid backing up its database while there's still operations going on with it.
8. Once Navidrome is shut down, backup its database file, `navidrome.db`. Its location is usually in navidrome `/data` folder. You can back up it either by copying it or with sqlite3 CLI if installed (`sqlite3 <path to original file> ".timeout 30000" ".backup <path to backup file>"` for instance). ⚠️ If Navidrome has been properly shut down, you shouldn't have any remaining `navidrome.db-shm` or `navidrome.db-wal` next to `navidrome.db`.
9. Download [this repository latest release](https://github.com/rombat/musicbee-navidrome-sync/releases/latest) .exe
10. Copy **only** `navidrome.db` and `MusicBee_Export.csv` in the same folder as this .exe (or you can provide pathes with CLI, see **Commands** below). 
11. Run the command you want to run (, see **Commands** below), your database file will be updated
12. Once it's done, go back to navidrome `/data` folder where you found `navidrome.db` and overwrite it with the updated one.
13. Restart Navidrome, and that's it !


## ⌨️ Commands

All commands must be run this way: `musicbee-navidrome-sync.exe [command name] [options]`.  
For instance, `musicbee-navidrome-sync.exe fullSync -h`

### fullSync

Syncs playcounts, track ratings, loved tracks and last played date from MusicBee DB to Navidrome DB. Runs on tracks first, then updates albums and artists accordingly.

#### Available options :

* `-f, --first` : runs sync for the first time: **add** MusicBee playcount to Navidrome playcount. If not used, playcount will be updated only if greater than Navidrome's one (see [Notes](#-notes)). 
* `--csv <path>` : MusicBee CSV source file path. By default if not passed, will look for a file named `MusicBee_Export.csv` in the same folder as `musicbee-navidrome-sync.exe`
* `--datetime-format <format>` : MusicBee CSV datetime format. Default: `"DD/MM/YYYY HH:mm"`. Use available formats from https://day.js.org/docs/en/display/format


### albumsSync

Updates all albums playcounts and ratings based on existing Navidrome DB.

### artistsSync

Updates all artists playcounts and ratings based on existing Navidrome DB

### Common options

All commands have these options available:
* `--db <path>` : Navidrome SQLITE .db source file path. By default if not passed, will look for a file named `navidrome.db` in the same folder as `musicbee-navidrome-sync.exe`
* `-u, --user <user_name>` : selects Navidrome username (by default if not used, the first found user will be used)
* `--verbose` : verbose debugging
* `--show-not-found` : display tracks that were not found in Navidrome database (useful for troubleshooting missing tracks without verbose output noise)
* `-h, --help` : displays help for command


## 📋 Notes

* This is a **one way sync** only, from MusicBee to Navidrome. Can't do the other way.
* A backup of your Navidrome DB is created in a newly created `backups` folder everytime you run a command
* Updates are only applied when they are more favorable (ex: MusicBee rating > Navidrome rating, MusicBee play date > Navidrome play date...)
* Ratings are updated on certain conditions:
  * For tracks: if MusicBee rating is greater than Navidrome rating
  * For albums, if more than half of the album tracks are rated (its rating will be the average of available tracks ratings)
  * For artists, same as album, will be applied only to artists with more than 1 track
* **Cross-version compatibility**: Automatically detects and works with both old and new Navidrome database schemas
* Tested with the following versions :
  * MusicBee:
    * 3.5.*
  * Advance Tagging and Reporting Tool:
    * 5.2.*
    * 5.7.*
    * 8.0.*
    * 9.2.*
  * Navidrome:
    * 0.47.5 up to 0.59.0
  

## ➡️ What's next ?

Maybe build it as a .exe GUI ?
If you have any enhancements suggestions, don't hesitate!


## ☕ Did you like this tool ?

If you found this tool useful, if it saved you some time, you can buy me a coffee !  
I'm more of a tea (or beer >_>) drinker, but I can appreciate a good coffee too.

<a href='https://ko-fi.com/rombat' target='_blank'><img height='40' style='border:0px;height:40px;' src='https://cdn.prod.website-files.com/5c14e387dab576fe667689cf/670f5a02fcf48af59c591185_support_me_on_kofi_dark-p-500.png' border='0' alt='Buy Me a Coffee at ko-fi.com' />


