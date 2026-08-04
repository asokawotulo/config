{ pkgs, ... }: {
  # Configure homebrew packages.
  homebrew = {
    enable = true;
    taps = [
      "anomalyco/tap"
    ];
    brews = [
      # Development tools
      "anomalyco/tap/opencode" # OpenCode is kept here because updates happen frequently, and we want to keep it up to date independently from nixpkgs.
      "pi-coding-agent"
      "rustup"

      # Network & testing tools
      "aria2"

      # Infrastructure/DevOps
      "tfenv"

      # Mobile & platform development
      "watchman"
      "xcode-build-server"
      "xcbeautify"

      # Python Dependencies
      "weasyprint"
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
      "obsidian"
      "protonvpn"
      "raycast"
      "setapp"
      "slack"
      "spotify"
      "whatsapp"
      "zen"

      # Dev environment & tools
      "claude-code@latest"
      "coderabbit"
      "cursor"
      "ghostty@tip"
      "mitmproxy"
      "postman"
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
