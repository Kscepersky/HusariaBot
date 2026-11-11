/**
 * Link do taska z DM-a (`/#tasks/<uuid>`) trafia tu po przekierowaniu do logowania.
 * Hash nie przetrwa podrozy przez OAuth Discorda, wiec zapamietujemy go w
 * sessionStorage, a dashboard odczytuje go po zalogowaniu. Akceptujemy wylacznie
 * ten jeden format - nic innego nie zostanie zapamietane ani otwarte.
 */
(function rememberTaskDeepLink(global) {
  'use strict'

  var DEEP_LINK_PATTERN = /^#tasks?(?:\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})?$/

  try {
    if (DEEP_LINK_PATTERN.test(global.location.hash)) {
      global.sessionStorage.setItem('husaria.pendingTaskLink', global.location.hash)
    }
  } catch (error) {
    // Brak sessionStorage - po zalogowaniu po prostu otworzy sie domyslna zakladka.
  }
})(window)
