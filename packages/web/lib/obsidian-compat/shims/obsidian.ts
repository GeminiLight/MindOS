/**
 * Obsidian Plugin Compatibility - obsidian module export surface
 */

import { Component } from '../component';
import { Events } from '../events';
import { Plugin } from './plugin';
import { Notice, Modal } from './ui';
import { PluginSettingTab, Setting } from './settings';
import { TAbstractFileImpl, TFileImpl, TFolderImpl } from './vault';

export function createObsidianModule() {
  return {
    Plugin,
    Component,
    Events,
    Notice,
    Modal,
    PluginSettingTab,
    Setting,
    TAbstractFile: TAbstractFileImpl,
    TFile: TFileImpl,
    TFolder: TFolderImpl,
  };
}
