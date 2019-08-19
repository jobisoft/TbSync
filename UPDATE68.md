# Update instructions for Thunderbird 68

TbSync has been mostly rewritten for Thunderbird 68 (the next major release being due in a few weeks). To ensure a seamless transition from Thunderbird 60 to Thunderbird 68, I recommend to do the following **before** upgrading to Thunderbird 68:

* synchronize all your TbSync accounts
* disable all your TbSync accounts

After the upgrade to Thunderbird 68 has completed, your TbSync accounts can be enabled again.

## How to disable TbSync accounts

Each TbSync account can be disabled by unchecking the box shown in the following image:

![](https://user-images.githubusercontent.com/5830621/63053657-9a2c6d80-bee2-11e9-9019-7035830a873b.png)]

## Why is this necessary ?

It could happen, that after the upgrade your synchronized address books and calendars still exists in Thunderbird and can be used as before, but are no longer connected to your servers. If you make local changes, they will never make it to your servers. So these changes will be lost.

That is why I ask to disable all accounts during the upgrade from Thunderbird 60 to Thunderbird 68. After re-enabling your accounts in Thunderbird 68, they will start a clean sync which ensures a proper connection between Thunderbird and your servers.

## System-specific tips

On Arch Linux and derivatives, you can add a `pacman` hook [like this one](https://gist.github.com/MayeulC/400adbfba72effc29fca4d8666fc4571) to print a reminder and cancel the thunderbird upgrade when it becomes available.
