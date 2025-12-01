import {
  hyperLayer,
  map,
  modifierLayer,
  rule,
  writeToProfile,
} from 'karabiner.ts'

writeToProfile('Default profile', [
  // #region Hyper Layer
  rule('Caps Lock to Hyper').manipulators([
    map('caps_lock').toHyper().toIfAlone('caps_lock'),
  ]),

  // ! Experiment with toggling layers
  // hyperLayer('x', 'HyperLayer - "x"', 1, 1).manipulators([
  //   map('a').to$('open raycast://extensions/raycast/raycast-ai/ai-chat').toVar('HyperLayer - "x"', 0)
  // ]),

  // ! Hyper Layer "o" is for opening apps
  hyperLayer('o', 'HyperLayer - "o"').manipulators([
    // map('a').toApp('Arc'),
    map('c').toApp('Calendar'),
    map('d').toApp('TablePlus'),
    map('e').toApp('Cursor'),
    map('f').toApp('Finder'),
    map('g').toApp('Google Chrome'),
    map('h').toApp('Core Shell'),
    map('i').toApp('Activity Monitor'),
    map('l').toApp('Slack'),
    map('n').toApp('Notion'),
    map('m').toApp('Airmail'),
    map('p').toApp('Postman'),
    map('s').toApp('Safari'),
    map('t').toApp('Ghostty'),
    map('w').toApp('WhatsApp'),
    map('z').toApp('Zen'),
    map('1').toApp('1Password'),
    map('2').toApp('Step Two'),
  ]),

  // ! Hyper Layer "r" is for raycast
  hyperLayer('r', 'HyperLayer - "r"').manipulators([
    // map('a').to$('open raycast://extensions/raycast/raycast-ai/ai-chat'),
  ]),

  // ! Hyper Layer "t" is for toggling
  hyperLayer('t', 'HyperLayer - "t"')
    .configKey((v) => v.toIfAlone('t', 'Hyper'))
    .manipulators([
      map('v').to$('open -g raycast://script-commands/toggle-vpn'),
      map('l').to('l', ['control', 'option']), // Toggle Low Power Mode through Shortcut
      map('g').to('g', ['control', 'option']), // Toggle AdGuard through Shortcut
    ]),

  // ! Hyper Layer "w" is for window management
  hyperLayer('w', 'HyperLayer - "w"').manipulators([
    map('1').to$('open -g raycast://extensions/raycast/window-management/top-left-quarter'),
    map('2').to$('open -g raycast://extensions/raycast/window-management/top-right-quarter'),
    map('3').to$('open -g raycast://extensions/raycast/window-management/bottom-left-quarter'),
    map('4').to$('open -g raycast://extensions/raycast/window-management/bottom-right-quarter'),
    map('left_arrow').to$('open -g raycast://extensions/raycast/window-management/left-half'),
    map('right_arrow').to$('open -g raycast://extensions/raycast/window-management/right-half'),
    map('up_arrow').to$('open -g raycast://extensions/raycast/window-management/maximize'),
    map('=').to$('open -g raycast://extensions/raycast/window-management/make-larger'),
    map('-').to$('open -g raycast://extensions/raycast/window-management/make-smaller'),
    map('.').to$('open -g raycast://extensions/raycast/window-management/next-desktop'),
    map(',').to$('open -g raycast://extensions/raycast/window-management/previous-desktop'),
    map('c').to$("open -g raycast://extensions/raycast/window-management/center"),
    map('l').to$("open -g 'raycast://customWindowManagementCommand?name=reasonableLarge'"),
    map('t').to$("open -g 'raycast://customWindowManagementCommand?name=reasonableLargeTop'"),
  ]),

  // ! Hyper Layer "d" is for docker
  hyperLayer('d', 'HyperLayer - "d"').manipulators([
    map('c').to$('open -g raycast://extensions/priithaamer/docker/container_list'),
    map('a').to$('open -a "OrbStack"'),
  ]),
  // #endregion

  // #region Fn Layer
  rule('Layer - Fn').manipulators([
    map('f1').to('display_brightness_decrement'),
    map('f2').to('display_brightness_increment'),
    map('f3').to('mission_control'),
    map('f4').to('spacebar', 'command'),
    map('f5').to('illumination_decrement'),
    map('f6').to('illumination_increment'),
    map('f7').to('rewind'),
    map('f8').toIfAlone('play_or_pause').toIfHeldDown({
      shell_command: 'open -a Spotify.app',
    }).parameters({
      "basic.to_if_alone_timeout_milliseconds": 200,
      "basic.to_if_held_down_threshold_milliseconds": 200,
    }),
    map('f9').to('fastforward'),
    map('f10').to('mute'),
    map('f11').to('volume_decrement'),
    map('f12').to('volume_increment'),
  ])
  // #endregion
])
