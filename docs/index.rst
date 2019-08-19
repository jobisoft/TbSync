TbSync Provider Documentation
=================================

This document tries to cover all aspects of how to create a provider add-on for TbSync to extends its sync capabilities. All TbSync providers are currently designed as *bootrapped extensions*, for which support is probably going to be dropped from Thunderbird at some time. We are working on migrate them into future proof *WebExtensions*.

Getting Started
---------------

To get started, generate a basic provider add-on skeleton, which will get you a working add-on for TB68 with some preconfigurations for your provider. The add-on file has the ``XPI`` extension, but is simply a zip file. Unzip it somewhere. You will see the following structure:

::

    Project
    ├── LICENSE          
    ├── manifest.json
    ├── chrome.manifest
    ├── bootstrap.js
    ├── skin          
    │   ├── logo16.png
    │   └── logo32.png
    │   └── logo48.png
    ├── _locales          
    │   └── en-US
    │       ├── provider.strings
    │       ├── provider.dtd
    │       └── messages.json
    └── content
        ├── provider.js        
        ├── includes
        │   └── sync.js    
        └── manager
            ├── provider.strings
            ├── provider.dtd
            └── messages.json

This documentation will refer to this structure and will explain the different files and folders as needed.

Registering your Provider
-------------------------

The file ``bootstrap.js`` is registering your provider with TbSync and the generated file should work out of the box. You should not touch it, if you do not know exactly what you are doing.


Implementing the Provider Interface
-----------------------------------

After your provider has been registered, TbSync will read the file ``provider.js``, where the provider interface has to be implemented.



.. js:autoclass:: base
   :members:

.. js:autoclass:: standardFolderList
   :members:
