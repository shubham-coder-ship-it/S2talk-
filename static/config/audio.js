/**
 * S2 Talk — Global Audio Configuration
 * -------------------------------------------------------------
 * This file is the single place to configure sound effects and
 * background music for the whole app.
 *
 * HOW TO REPLACE A SOUND WITH A REAL AUDIO FILE:
 *   1. Drop your .mp3/.ogg/.wav file into:
 *        /static/assets/audio/sounds/   (for short one-shot effects)
 *        /static/assets/audio/music/    (for looping ambience/music)
 *   2. Add its filename below, next to the matching key.
 *   3. Reload the app — it will automatically play your file instead
 *      of the built-in synthesized sound. If a file is missing or
 *      fails to load, S2 Talk falls back to the synthesized sound
 *      automatically, so the app never breaks.
 *
 * No other code changes are required — static/js/app.js reads this
 * file (window.S2AudioConfig) at startup.
 */
window.S2AudioConfig = {
  soundsPath: '/static/assets/audio/sounds/',
  musicPath: '/static/assets/audio/music/',

  // One-shot sound effects. Leave a value as '' (empty string) to keep
  // using the built-in synthesized sound for that action.
  sounds: {
    enterHouse: '',      // e.g. 'enter-house.mp3'
    exitHouse: '',       // e.g. 'exit-house.mp3'
    footstep: '',        // e.g. 'footstep.mp3'
    carStart: '',        // e.g. 'car-start.mp3'
    horn: '',            // e.g. 'horn.mp3'
    notification: '',    // e.g. 'notification.mp3'
    messageSent: '',     // e.g. 'message-sent.mp3'
    friendRequest: '',   // e.g. 'friend-request.mp3'
    recordStart: '',     // e.g. 'record-start.mp3'
    recordStop: '',      // e.g. 'record-stop.mp3'
  },

  // Looping ambience/music tracks.
  music: {
    rain: '',            // e.g. 'rain-ambience.mp3'
    cityAmbience: '',    // e.g. 'city-ambience.mp3'

  },

  // Default volume (0.0 - 1.0) applied on first load, before the user
  // changes it in Settings. The user's own choice is then saved to
  // localStorage and takes over on future visits.
  defaultVolume: 0.5,
};
