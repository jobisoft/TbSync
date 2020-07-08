@echo off
REM  This file is part of TbSync.
REM 
REM This Source Code Form is subject to the terms of the Mozilla Public
REM License, v. 2.0. If a copy of the MPL was not distributed with this
REM file, You can obtain one at http://mozilla.org/MPL/2.0/.

del TbSync-beta.xpi
"C:\Program Files\7-Zip\7zG.exe" a -tzip TbSync-beta.xpi content _locales manifest.json LICENSE README.md background.js CONTRIBUTORS.md


REM Copy sources to doc repository
rd /s /q ..\Provider-4-TbSync\docs\sources 
mkdir ..\Provider-4-TbSync\docs\sources 

copy content\OverlayManager.jsm ..\Provider-4-TbSync\docs\sources\

Xcopy /E /I content\passwordPrompt ..\Provider-4-TbSync\docs\sources\passwordPrompt\
Xcopy /E /I content\modules ..\Provider-4-TbSync\docs\sources\modules\
