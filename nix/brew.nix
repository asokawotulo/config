{ pkgs, ... }: {
  # Configure homebrew packages.
  homebrew = {
    enable = true;
    taps = [
      "sst/tap"
    ];
    brews = [
      # Development tools
      "opencode" # OpenCode is kept here because updates happen frequently, and we want to keep it up to date independently from nixpkgs.

      # Mobile & platform development
      "xcode-build-server"
      "xcbeautify"
    ];
    casks = [
      # General apps
      "1password"
      "adguard"
      "appcleaner"
      "discord"
      "google-chrome"
      "google-drive"
      "imageoptim"
      "karabiner-elements"
      "notion"
      "protonvpn"
      "raycast"
      "setapp"
      "slack"
      "spotify"
      "vlc"
      "whatsapp"
      "zen"
      "zoom"

      # Dev environment & tools
      "claude-code"
      "cursor"
      "postman"
      "warp"
      "zulu@17"

      # Mobile & platform development
      "android-studio"

      # Virtualization & containerization
      "orbstack"

      # 3D, CAD, and printing
      "autodesk-fusion"
      "orcaslicer"
    ];
    masApps = {
      "Airmail - Lightning Fast Email" = 918858936;
      "Microsoft Excel" = 462058435;
      "Microsoft Word" = 462054704;
    };
  };
}
