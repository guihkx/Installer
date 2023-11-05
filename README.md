## Deprecation notice

[A long time ago](https://github.com/BetterDiscord/Installer/issues/26#issuecomment-817454327), I started this soft fork of the BetterDiscord Installer, mainly because:

1. I wanted to make BetterDiscord easily installable on the Flatpak build of Discord
2. [`betterdiscordctl`](https://github.com/bb010g/betterdiscordctl) couldn't do it at the time

Point 2 was actually [addressed](https://github.com/BetterDiscord/Installer/issues/26#issuecomment-847091088) shortly after I started this fork, but I still felt I was adding value to the community with this, because a graphical installer is undoubtely user-friendlier than a command-line-based one.

However, let's be real for a second: Using [Electron](https://www.electronjs.org/docs/latest/) to make an app (i.e. this installer) to essentially download a single file into a directory seems *really* overkill, wouldn't you agree...? 😅

Additionally, the Electron version bundled in this is installer is currently using (`13.6.x`) is largely outdated, possibly insecure and [has no official support anymore](https://www.electronjs.org/docs/latest/tutorial/electron-timelines).

Therefore, I'd recommend either switching to [`betterdiscordctl`](https://github.com/bb010g/betterdiscordctl), or just waiting for Flatpak support to be added in the official installer. See [effort #1](https://github.com/BetterDiscord/Installer/pull/282), and [effort #2](https://github.com/BetterDiscord/Installer/pull/348) (the most recent one).

At the time of this writing, this tool still works, and will probably still keep working for some time, but I'd recommend adapting to a new and supported tool as soon as possible.

Thank you for using this! <3