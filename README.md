# TbSync

1. [Introduction](https://github.com/jobisoft/TbSync#introduction)
2. [Where is this going?](https://github.com/jobisoft/TbSync#where-is-this-going)
3. [External data sources](https://github.com/jobisoft/TbSync#external-data-sources)
4. [Icon sources and attributions](https://github.com/jobisoft/TbSync#icon-sources-and-attributions)

## Introduction

[TbSync](https://addons.thunderbird.net/addon/tbsync/) is a central user interface to manage cloud accounts and to synchronize their contact, task and calendar information with [Thunderbird](https://www.thunderbird.net/). Its main objective is to simplify the setup process for such accounts. The following providers (protocols) are currently supported:
* CalDAV & CardDAV, via [DAV-4-TbSync](https://github.com/jobisoft/DAV-4-TbSync) 
[[compatibility list (DAV)](https://github.com/jobisoft/DAV-4-TbSync/wiki/Compatibility-list-(DAV))]
* Exchange ActiveSync (EAS v2.5 & v14.0), via [EAS-4-TbSync](https://github.com/jobisoft/EAS-4-TbSync) 
[[compatibility list (EAS)](https://github.com/jobisoft/EAS-4-TbSync/wiki/Compatibility-list-(EAS))]

Further details can be found in the [wiki](https://github.com/jobisoft/TbSync/wiki) of the TbSync project and in the [how-to-get-started guide](https://github.com/jobisoft/TbSync/wiki/How-to-get-started).

If you like TbSync and want to support its development, please consider a donation.

[![](https://www.paypalobjects.com/en_US/DK/i/btn/btn_donateCC_LG.gif)](https://www.paypal.me/johnbieling)


## Want to add or fix a localization?
To help translating this project, please visit [crowdin.com](https://crowdin.com/profile/jobisoft), where the localizations are managed. If you want to add a new language, just contact me and I will set it up.

Here are some general information regarding translations:

* [Localization content best practices](https://developer.mozilla.org/en-US/docs/Mozilla/Localization/Localization_content_best_practices)
* [Summary table of quotation marks per language](https://en.wikipedia.org/wiki/Quotation_mark#Summary_table)
* [Transvision](https://transvision.mozfr.org/) provides translations for various languages
* by Thunderbird supported [locale codes](https://searchfox.org/comm-central/source/mail/locales/all-locales)


## Where is this going?

I want to adapt Thunderbirds WebExtension APIs to simplify the addition of additional address book and calendar providers. I plan to keep TbSync as a central UI.


## Icon sources and attributions

#### WTFPL
* [spinner.gif] by [Yannick Croissant](http://www.ajaxload.info/)

#### CC0-1.0
* [add16.png] by [Jean Victor Balin](https://openclipart.org/detail/16950/add)
* [del16.png] by [Jean Victor Balin](https://openclipart.org/detail/16982/cross)
* [tick16.png] by [Jean Victor Balin](https://openclipart.org/detail/17056/tick)
* [sync16.png] by [Willleam](https://openclipart.org/detail/287463/circular-arrow-blue)
* [slider-on.png] by [John Bieling](https://github.com/jobisoft/TbSync/blob/master/content/skin/src/LICENSE)
* [slider-off.png] by [John Bieling](https://github.com/jobisoft/TbSync/blob/master/content/skin/src/LICENSE)

#### CC-BY 3.0
* [contacts16.png] by [Yusuke Kamiyamane](https://www.iconfinder.com/icons/25910/)
* [todo16.png] by [Yusuke Kamiyamane](https://www.iconfinder.com/icons/45913/)
* [error16.png] by [Yusuke Kamiyamane](https://www.iconfinder.com/icons/46013/exclamation_frame_icon)
* [connect16.png] by [Yusuke Kamiyamane](https://www.iconfinder.com/icons/58341/connect_plug_icon)
* [info16.png] by [FatCow Web Hosting](https://www.iconfinder.com/icons/64363/info_rhombus_icon)
* [warning16.png] by [FatCow Web Hosting](https://www.iconfinder.com/icons/36026/)
* [calendar16.png] by [FatCow Web Hosting](https://www.iconfinder.com/icons/35805/)
* [calendar/contacts16_shared.png] by [FatCow Web Hosting](https://www.iconfinder.com/icons/64490/network_share_icon)
* [trash16.png] by [FatCow Web Hosting](https://www.iconfinder.com/icons/35727/bin_empty_metal_icon)
* [acl_rw.png] by [FatCow Web Hosting](https://www.iconfinder.com/icons/36322/pencil_icon)
* [acl_ro.png] by [FatCow Web Hosting](https://www.iconfinder.com/icons/36324/delete_pencil_icon)
* [provider16.png] by [FatCow Web Hosting](https://www.iconfinder.com/icons/64634)
* [report_send.png] based on work by FatCow Web Hosting [#1](https://www.iconfinder.com/icons/36365/) and [#2](https://www.iconfinder.com/icons/93180)
* [report_open.png] by [FatCow Web Hosting](https://www.iconfinder.com/icons/36373)
* [lock24.png] by [Paomedia](https://www.iconfinder.com/icons/285646/lock_icon)
* [tbsync.png] by [Paomedia](https://www.iconfinder.com/icons/299097)
* [settings32.png] by [Paomedia](https://www.iconfinder.com/icons/299098/cogs_icon)
* [update32.png] by [Google](https://www.iconfinder.com/icons/352158/)
* [group32.png] by [Dumitriu Robert](https://www.iconfinder.com/icons/3289557/clan_group_partners_peers_people_icon)
* [catman32.png] based on 'Venn Diagram' by [WARPAINT Media Inc., CA](https://thenounproject.com/search/?q=three%20circles&i=31898#) from Noun Project ([info](https://github.com/jobisoft/CategoryManager/tree/master/sendtocategory/skin/catman))

#### Apache Software License 2.0
* [disabled16.png] by [Google](https://github.com/google/material-design-icons/blob/master/notification/1x_web/ic_do_not_disturb_alt_black_18dp.png)

#### GPL
* [help32.png] by [WooThemes](https://www.iconfinder.com/icons/58495/button_help_white_icon)
