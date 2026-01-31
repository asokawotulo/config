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

      # Network & testing tools
      "aria2"

      # Mobile & platform development
      "xcode-build-server"
      "xcbeautify"

      # Python Dependencies
      # WeasyPrint dependencies
      "cairo"
      "pango"
      "gdk-pixbuf"
      "libffi"
    ];
    casks = [
      # General apps
      "1password"
      "adguard"
      "appcleaner"
      "discord"
      "google-chrome"
      "google-drive"
      "iina"
      "imageoptim"
      "karabiner-elements"
      "notion"
      "protonvpn"
      "raycast"
      "setapp"
      "slack"
      "spotify"
      "whatsapp"
      "zen"

      # Dev environment & tools
      "antigravity"
      "claude-code"
      "cursor"
      "ghostty@tip"
      "postman"
      "zulu@17"

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
