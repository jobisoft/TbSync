# TbSync

**TbSync is currently being reorganized: The EAS provider will be removed from TbSync and placed into its own add-on.**

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

TbSync introduces a Sync API, which allows other add-ons to hook into TbSync, allowing them to reuse most of the synchronization glue code.

Further details can be found in the [wiki](https://github.com/jobisoft/TbSync/wiki) of the TbSync project and in the [how-to-get-started guide](https://github.com/jobisoft/TbSync/wiki/How-to-get-started).

## Translations and localizations

* [Localization content best practices](https://developer.mozilla.org/en-US/docs/Mozilla/Localization/Localization_content_best_practices)
* [Summary table of quotation marks per language](https://en.wikipedia.org/wiki/Quotation_mark#Summary_table)
* [Transvision](https://transvision.mozfr.org/) provides translations for various languages
* by Thunderbird supported [locale codes](https://searchfox.org/comm-central/source/mail/locales/all-locales)

If you encounter a misspelled translation key, do not correct it but report it to me. The translation keys are only used as variables in the code and are not visible. But changing a translation key requires all other translations and all references to that key in the code to be changed as well. Since translation keys are sometimes build up by string concatenation, it is not as easy as doing a global find and replace.

## Where is this going?

I started to work on TbSync, because we needed ActiveSync (EAS) support in Thunderbird. Soon after, I realized that the current situation for sync accounts is very confusing in terms of user experience: There was no central place to set up sync accounts. The same DAV account had to be setup in lightning and again in the sogo-connector or in CardBook. EWS accounts are setup differently again and for google we need 3 different add-ons for contacts, calendars and tasks.

With TbSync I want to unify that: A central manager to setup sync accounts (DAV, EAS, EWS, Google, ...) and get contacts, tasks and calendars. I knew that I will not be able to re-create and maintain all the different providers for TbSync by myself. I thus created (and still work on) a TbSync API, which allows other add-ons to hook into TbSync and re-use most of the glue code. My DAV provider is a proof-of-concept of that API (and a replacement for the sogo-connector, which was not working with TB60 anymore).

I am in contact with Thunderbird staff and we are trying to get TbSync integrated directly into Thunderbird. No ETA yet.

The next step is to [cooperate with CardBook](https://github.com/jobisoft/TbSync/issues/105), so it does not matter, if the user wants to use the "old" Thunderbird address book or the new vCard address book. Every provider available for TbSync should be able to sync into CardBook as well. I hope we get this done before the end of this year.

Later I want to support the [EWS community](https://github.com/ExchangeCalendar/exchangecalendar), which is interested in turning their add-on into a provider for TbSync.

After that, I would like to create or help others to create a google provider for TbSync. We will see how that goes, nothing is planed yet.

## Icon sources and attributions

#### WTFPL
* [spinner.gif] by [Yannick Croissant](http://www.ajaxload.info/)

#### CC0-1.0
* [add16.png] by [Jean Victor Balin](https://openclipart.org/detail/16950/add)
* [del16.png] by [Jean Victor Balin](https://openclipart.org/detail/16982/cross)
* [tick16.png] by [Jean Victor Balin](https://openclipart.org/detail/17056/tick)
* [sync16.png] by [Willleam](https://openclipart.org/detail/287463/circular-arrow-blue)
* [slider-on.png] by [John Bieling](https://github.com/jobisoft/TbSync/blob/master/skin/src/LICENSE)
* [slider-off.png] by [John Bieling](https://github.com/jobisoft/TbSync/blob/master/skin/src/LICENSE)

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
