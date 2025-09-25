{ pkgs, ... }: {
  # Configure homebrew packages.
  homebrew = {
    enable = true;
    brews = [
      "opencode"
	  "zoxide"
	  "aria2"
    ];
    casks = [
      "1password"
      "adguard"
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
      "zoom"
      "zen"
    ];
    masApps = {
      "Airmail - Lightning Fast Email" = 918858936;
      "Microsoft Excel" = 462058435;
      "Microsoft PowerPoint" = 462062816;
      "Microsoft Word" = 462054704;
    };
  };
}
