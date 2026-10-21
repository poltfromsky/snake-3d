import { test } from 'node:test';
import assert from 'node:assert/strict';

import { installKind } from '../src/ui/device.js';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  ipadDesktop: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  androidChrome: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
  winChrome: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  winYandex: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 YaBrowser/24.10.0.0 Safari/537.36',
  winFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:131.0) Gecko/20100101 Firefox/131.0',
  macChrome: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  telegramAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36 Telegram-Android/11.2.0',
};

test('инструкция по установке подбирается под браузер и устройство', () => {
  assert.equal(installKind(UA.iphone, 5), 'ios');
  assert.equal(installKind(UA.ipadDesktop, 5), 'ios', 'iPad «как на компьютере» — по сенсорному экрану');
  assert.equal(installKind(UA.ipadDesktop, 0), 'safari-mac');
  assert.equal(installKind(UA.androidChrome, 5), 'android');
  assert.equal(installKind(UA.androidFirefox, 5), 'firefox-android');
  assert.equal(installKind(UA.winChrome, 0), 'desktop');
  assert.equal(installKind(UA.winYandex, 0), 'desktop');
  assert.equal(installKind(UA.macChrome, 0), 'desktop', 'Chrome на Mac — не Safari');
  assert.equal(installKind(UA.winFirefox, 0), 'firefox-desktop');
  assert.equal(installKind(UA.telegramAndroid, 5), 'inapp');
});
