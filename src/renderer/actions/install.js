import {progress} from "../stores/installation";
import {remote} from "electron";
import {promises as fs} from "fs";
import originalFs from "original-fs";
import path from "path";
import phin from "phin";

import {log, lognewline} from "./utils/log";
import succeed from "./utils/succeed";
import fail from "./utils/fail";
import exists from "./utils/exists";
import reset from "./utils/reset";
import kill from "./utils/kill";
import restart from "./utils/restart";
import {showRestartNotice, showKillNotice} from "./utils/notices";
import doSanityCheck from "./utils/sanity";

const KILL_DISCORD_PROGRESS = 10;
const MAKE_DIR_PROGRESS = 20;
const CHECK_OLD_INSTALL = 30;
const TRANSFER_OLD_ADDONS = 40;
const DOWNLOAD_PACKAGE_PROGRESS = 60;
const INJECT_SHIM_PROGRESS = 80;
const RENAME_ASAR_PROGRESS = 90;
const RESTART_DISCORD_PROGRESS = 100;

const oldBDFolder = path.join(remote.app.getPath("home"), "Library", "Preferences", "betterdiscord"); // Old MacOS
const bdFolder = path.join(remote.app.getPath("appData"), "BetterDiscord");
const bdDataFolder = path.join(bdFolder, "data");
const bdPluginsFolder = path.join(bdFolder, "plugins");
const bdThemesFolder = path.join(bdFolder, "themes");

async function checkOldMacOS(folder) {
    if (await exists(folder)) {
        log(`⚠️ Found old BD installation: ${folder}`);
        return true;
    }
    return false;
}

async function transferOldAddons(oldFolder, newFolder) {
    if (await exists(oldFolder)) {
        const addons = await fs.readdir(oldFolder);
        for (let a = 0; a < addons.length; a++) {
            const oldName = path.join(oldFolder, addons[a]);
            const newName = path.join(newFolder, addons[a]);
            const stats = await fs.stat(oldName);
            if (!stats.isFile()) continue;
            try {
                await fs.rename(oldName, newName);
            }
            catch (err) {
                log(`❌ Failed to transfer: ${addons[a]}`);
            }
        }
    }
}

async function makeDirectories(...folders) {
    const progressPerLoop = (MAKE_DIR_PROGRESS - progress.value) / folders.length;
    for (const folder of folders) {
        if (await exists(folder)) {
            log(`✅ Directory exists: ${folder}`);
            progress.set(progress.value + progressPerLoop);
            continue;
        }
        try {
            await fs.mkdir(folder);
            progress.set(progress.value + progressPerLoop);
            log(`✅ Directory created: ${folder}`);
        }
        catch (err) {
            log(`❌ Failed to create directory: ${folder}`);
            log(`❌ ${err.message}`);
            return err;
        }
    }
}

const getJSON = phin.defaults({method: "GET", parse: "json", followRedirects: true, headers: {"User-Agent": "BetterDiscord Installer"}});
const downloadFile = phin.defaults({method: "GET", followRedirects: true, headers: {"User-Agent": "BetterDiscord Installer", "Accept": "application/octet-stream"}});
const asarPath = path.join(bdDataFolder, "betterdiscord.asar");
async function downloadAsar() {
    const releaseApiUrl = "https://api.github.com/repos/BetterDiscord/BetterDiscord/releases";
    try {
        const response = await getJSON(releaseApiUrl);
        const releases = response.body;
        const asset = releases && releases.length && releases[0].assets && releases[0].assets.find(a => a.name.toLowerCase() === "betterdiscord.asar");
        const assetUrl = asset && asset.url;
        if (!assetUrl) {
            let errMessage = "Could not get the asset url";
            if (!asset) errMessage = "Could not get asset object";
            if (!releases) errMessage = "Could not get response body";
            if (!response) errMessage = "Could not get any response";
            throw new Error(errMessage);
        }
        try {
            const resp = await downloadFile(assetUrl);
            const ofs = originalFs.promises; // because electron doesn't like when I write asar files
            await ofs.writeFile(asarPath, resp.body);
        }
        catch (error) {
            log(`❌ Failed to download package from ${assetUrl}`);
            log(`❌ ${error.message}`);
            return error;
        }
    }
    catch (err) {
        log(`❌ Failed to get asset url from ${releaseApiUrl}`);
        log(`❌ ${err.message}`);
        return err;
    }
}

async function injectShims(paths) {
    const progressPerLoop = (INJECT_SHIM_PROGRESS - progress.value) / paths.length;
    for (const discordPath of paths) {
        log("Injecting into: " + discordPath);
        const appPath = path.join(discordPath, "app");
        const pkgFile = path.join(appPath, "package.json");
        const indexFile = path.join(appPath, "index.js");
        try {
            if (process.platform === "win32" || process.platform === "darwin") {
                if (!(await exists(appPath))) await fs.mkdir(appPath);
                await fs.writeFile(pkgFile, JSON.stringify({name: "betterdiscord", main: "index.js"}));
                await fs.writeFile(indexFile, `require("${asarPath.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}");`);
            }
            else {
                await fs.writeFile(path.join(discordPath, "index.js"), `require("${asarPath.replace(/\\/g, "\\\\").replace(/"/g, "\\\"")}");\nmodule.exports = require("./core.asar");`);
            }
            log("✅ Injection successful");
            progress.set(progress.value + progressPerLoop);
        }
        catch (err) {
            log(`❌ Could not inject shims to ${discordPath}`);
            log(`❌ ${err.message}`);
            return err;
        }
    }
}

async function renameAsar(paths) {
    const progressPerLoop = (RENAME_ASAR_PROGRESS - progress.value) / paths.length;
    for (const discordPath of paths) {
        const appAsar = path.join(discordPath, "app.asar");
        const discordAsar = path.join(discordPath, "discord.asar");
        log("Renaming " + appAsar);
        try {
            const appAsarExists = originalFs.existsSync(appAsar);
            const discordAsarExists = originalFs.existsSync(discordAsar);
            if (!appAsarExists && !discordAsarExists) throw new Error("Discord installation corrupt, please reinstall.");
            if (appAsarExists && discordAsarExists) originalFs.rmSync(discordAsar);
            if (appAsarExists) originalFs.renameSync(appAsar, discordAsar);
            log("✅ Rename successful");
            progress.set(progress.value + progressPerLoop);
        }
        catch (error) {
            log(`❌ Could not rename asar ${appAsar}`);
            log(`❌ ${error.message}`);
            return error;
        }

    }
}


export default async function(config) {
    await reset();
    const sane = doSanityCheck(config);
    if (!sane) return fail();


    const channels = Object.keys(config);
    const paths = Object.values(config);

    lognewline("Stopping Discord...");
    const killErr = await kill(channels, (KILL_DISCORD_PROGRESS - progress.value) / channels.length);
    if (killErr) {
        showKillNotice();
        return fail();
    }
    log("✅ Discord stopped");
    progress.set(KILL_DISCORD_PROGRESS);


    lognewline("Creating required directories...");
    const makeDirErr = await makeDirectories(bdFolder, bdDataFolder, bdThemesFolder, bdPluginsFolder);
    if (makeDirErr) return fail();
    log("✅ Directories created");
    progress.set(MAKE_DIR_PROGRESS);


    if (process.platform === "darwin") {
        lognewline("Checking for old MacOS installation...");
        const found = await checkOldMacOS(oldBDFolder);
        progress.set(CHECK_OLD_INSTALL);
        if (found) {
            const confirmation = await remote.dialog.showMessageBox(remote.BrowserWindow.getFocusedWindow(), {
                type: "question",
                title: "Old Install Found",
                message: "Found an old BD installation, do you want to transfer your plugins and themes?",
                noLink: true,
                cancelId: 1,
                buttons: ["Yes", "No"]
            });
        
            if (confirmation.response === 0) {
                await transferOldAddons(path.join(oldBDFolder, "plugins"), path.join(bdFolder, "plugins"));
                await transferOldAddons(path.join(oldBDFolder, "themes"), path.join(bdFolder, "themes"));
                progress.set(TRANSFER_OLD_ADDONS);
            }
        }
    }
    

    lognewline("Downloading asar file");
    const downloadErr = await downloadAsar();
    if (downloadErr) return fail();
    log("✅ Package downloaded");
    progress.set(DOWNLOAD_PACKAGE_PROGRESS);


    lognewline("Injecting shims...");
    const injectErr = await injectShims(paths);
    if (injectErr) return fail();
    log("✅ Shims injected");
    progress.set(INJECT_SHIM_PROGRESS);

    if (process.platform === "win32" || process.platform === "darwin") {
        lognewline("Renaming asars...");
        const renameAsarErr = await renameAsar(paths);
        if (renameAsarErr) return fail();
        log("✅ Asars renamed");
        progress.set(RENAME_ASAR_PROGRESS);
    }


    lognewline("Restarting Discord...");
    const restartErr = await restart(channels, (RESTART_DISCORD_PROGRESS - progress.value) / channels.length);
    if (restartErr) showRestartNotice(); // No need to bail out and show failed
    else log("✅ Discord restarted");
    progress.set(RESTART_DISCORD_PROGRESS);


    succeed();
};