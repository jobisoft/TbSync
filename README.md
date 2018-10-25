# TbSync

1. [Introduction](https://github.com/jobisoft/TbSync#introduction)
2. [Where is this going?](https://github.com/jobisoft/TbSync#where-is-this-going)
3. [External data sources](https://github.com/jobisoft/TbSync#external-data-sources)
4. [Icon sources and attributions](https://github.com/jobisoft/TbSync#icon-sources-and-attributions)

### Introduction

[Thunderbird Add-On] Sync contacts, tasks and events to Thunderbird. The following servers are supported:
* Exchange ActiveSync (EAS v2.5 & v14.0)
* sabre/dav (CalDAV & CardDAV), via [DAV-4-TbSync](https://github.com/jobisoft/DAV-4-TbSync)

Further details can be found in the [wiki](https://github.com/jobisoft/TbSync/wiki) of the TbSync project and in the [how-to-get-started guide](https://github.com/jobisoft/TbSync/wiki/How-to-get-started).

### Where is this going?

I started to work on TbSync, because my wife needed ActiveSync (EAS) support in Thunderbird. Soon after, I realized that the current situation for external accounts is very confusing, there was no central place to set up accounts. The same DAV account had to be setup in lightning and again in the sogo-connector or in CardBook. EWS accounts are setup differently again and for google we need 3 different addons for contacts, calendars and tasks. With TbSync I want to unify that: A central manager to setup sync accounts (DAV, EAS, EWS, Google, ...) and get contacts, tasks and calendars.

For the start I left out e-mail support, because it was not clear if JS Account will continue to exist and I also wanted to start fast and thus did not try to mess with the Thunderbird Account Manager, but created a independent Sync Account Manager. Most provider allow IMAP anyway.

I knew that I will not able to recreate all the different providers for TbSync and I also will not be able to maintain them. I thus created (and still work on) a TbSync API, which allows other Add-Ons to hook into TbSync and re-use most of the glue code. My DAV provider is a proof-of-concept of that API (and a replacement for the sogo-connector, which was not working with TB60 anymore).

The next step is to [cooperate with CardBook](https://github.com/jobisoft/TbSync/issues/105), so it does not matter, if the user wants to use the "old" Thunderbird address book or the new vCard address book. Every provider available for TbSync should be able to sync into CardBook as well. I hope we get this done before the end of this year.

The next step is to work on the EWS-provider for TbSync. The [EWS community](https://github.com/ExchangeCalendar/exchangecalendar) is interested and I started to [work on it](https://github.com/jobisoft/EWS-4-TbSync), but since they managed to get their Add-On working with TB60, I shifted focus a bit. But my intention is to help them to convert their Add-on to become a TbSync provider.
 
After that, I would like to create or help others to create a google provider for TbSync. We will see how that goes, nothing is planed yet.

Furthermore, if JS Account will survive and e-mail support can be added to the TbSync API, I would probably merge my Sync Account Manager into the Thunderbird Account Manager.

### External data sources

* TbSync uses a [timezone mapping](https://github.com/mj1856/TimeZoneConverter/blob/master/src/TimeZoneConverter/Data/Mapping.csv.gz) provided by [Matt Johnson](https://github.com/mj1856)

### Icon sources and attributions

#### CC0-1.0
* [add16.png] by [Jean Victor Balin](https://openclipart.org/detail/16950/add)
* [del16.png] by [Jean Victor Balin](https://openclipart.org/detail/16982/cross)
* [tick16.png] by [Jean Victor Balin](https://openclipart.org/detail/17056/tick)
* [cape32.png/cape_logo.png] by [jpenrici](https://openclipart.org/detail/195795/tree17)
* [sync16.png] by [Willleam](https://openclipart.org/detail/287463/circular-arrow-blue)
* [slider-on.png] by [John Bieling](https://github.com/jobisoft/TbSync/blob/master/skin/src/LICENSE)
* [slider-off.png] by [John Bieling](https://github.com/jobisoft/TbSync/blob/master/skin/src/LICENSE)

#### CC-BY 3.0
* [contacts16.png] by [Yusuke Kamiyamane](https://www.iconfinder.com/icons/25910/)
* [todo16.png] by [Yusuke Kamiyamane](https://www.iconfinder.com/icons/45913/)
* [error16.png] by [Yusuke Kamiyamane](https://www.iconfinder.com/icons/46013/exclamation_frame_icon)
* [connect16.png] by [Yusuke Kamiyamane](https://www.iconfinder.com/icons/58341/connect_plug_icon)
* [eas16.png] by [FatCow Web Hosting](https://www.iconfinder.com/icons/64484/exchange_ms_icon)
* [info16.png] by [FatCow Web Hosting](https://www.iconfinder.com/icons/64363/info_rhombus_icon)
* [warning16.png] by [FatCow Web Hosting](https://www.iconfinder.com/icons/36026/)
* [calendar16.png] by [FatCow Web Hosting](https://www.iconfinder.com/icons/35805/)
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
