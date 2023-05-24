Version: 1.21
-------------
- Explicitly set hasAddonManagerEventListeners flag to false on uninstall

Version: 1.20
-------------
- hard fork BootstrapLoader v1.19 implementation and continue to serve it for
  Thunderbird 111 and older
- BootstrapLoader v1.20 has removed a lot of unnecessary code used for backward
  compatibility

Version: 1.19
-------------
- fix race condition which could prevent the AOM tab to be monkey patched correctly

Version: 1.18
-------------
- be precise on which revision the wrench symbol should be displayed, instead of
  the options button

Version: 1.17
-------------
- fix "ownerDoc.getElementById() is undefined" bug

Version: 1.16
-------------
- fix "tab.browser is undefined" bug

Version 1.15
------------
- clear cache only if add-on is uninstalled/updated, not on app shutdown

Version 1.14
------------
- fix for TB90 ("view-loaded" event) and TB78.10 (wrench icon for options)

Version 1.13
------------
- removed notifyTools and move it into its own NotifyTools API

Version 1.12
------------
- add support for notifyExperiment and onNotifyBackground

Version 1.11
------------
- add openOptionsDialog()

Version 1.10
------------
- fix for 68

Version 1.7
-----------
- fix for beta 87

Version 1.6
-----------
- add support for options button/menu in add-on manager and fix 68 double menu entry

Version 1.5
-----------
- fix for e10s

Version 1.4
-----------
- add registerOptionsPage

Version 1.3
-----------
- flush cache

Version 1.2
-----------
- add support for resource urls
