{ pkgs, ... }: {
  # Configure homebrew packages.
  homebrew = {
    enable = true;
    taps = [
      "sst/tap"
    ];
    brews = [
      "opencode" # OpenCode is kept here because updates happen frequently, and we want to keep it up to date independently from nixpkgs.
    ];
    casks = [
      "1password"
      "adguard"
      "android-studio"
      "appcleaner"
      "autodesk-fusion"
      "cursor"
      "discord"
      "google-chrome"
      "google-drive"
      "imageoptim"
      "karabiner-elements"
      "notion"
      "orbstack"
      "orcaslicer"
      "postman"
      "protonvpn"
      "raycast"
      "setapp"
      "slack"
      "spotify"
      "steam"
      "vlc"
      "warp"
      "whatsapp"
      "zen"
      "zoom"
      "zulu@17" # OpenJDK for Java
    ];
    masApps = {
      "Airmail - Lightning Fast Email" = 918858936;
      "Microsoft Excel" = 462058435;
      "Microsoft PowerPoint" = 462062816;
      "Microsoft Word" = 462054704;
    };
  };
}
