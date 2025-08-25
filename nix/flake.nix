{
  description = "My system flake";

  inputs = {
    # Nixpkgs
    nixpkgs.url = "github:NixOS/nixpkgs/nixpkgs-unstable";

    # Nix Darwin
    nix-darwin.url = "github:LnL7/nix-darwin";
    nix-darwin.inputs.nixpkgs.follows = "nixpkgs";

    # Home Manager
    home-manager.url = "github:nix-community/home-manager";
    home-manager.inputs.nixpkgs.follows = "nixpkgs";
  };

  outputs = inputs@{ self, nix-darwin, home-manager, nixpkgs }:
  let
    configuration = { pkgs, ... }: {
      # User
      users.users.asoka.home = "/Users/asoka";
      # nix.configureBuildUsers = true;
      # nix.useDaemon = true;
      # services.nix-daemon.enable = true;

      # Nix configurations.
      nix.settings.experimental-features = "nix-command flakes";
      nix.settings.trusted-users = [ "root" "asoka" ];

      # The platform the configuration will be used on.
      nixpkgs.hostPlatform = "aarch64-darwin";

      # NOTE: Workaround for packages with licenses that are not free.
      nixpkgs.config.allowUnfree = true;

      # Packages to be installed in the system profile.
      environment.systemPackages =
        [
          pkgs.direnv
          pkgs.devenv
          pkgs.ngrok
          pkgs.ookla-speedtest
          pkgs.oha
          pkgs.starship
          pkgs.awscli2
          pkgs.terraform
          pkgs.packer
          pkgs.httpie
          pkgs.mysql84
          pkgs.nodejs_22
          pkgs.bun
          pkgs.php81
          pkgs.go
          # TODO: Add packages from homebrew that are available in nixpkgs.
        ];

      # Create /etc/zshrc that loads the nix-darwin environment.
      programs.zsh.enable = true;

      # Set Git commit hash for darwin-version.
      system.configurationRevision = self.rev or self.dirtyRev or null;
      system.stateVersion = 5;

      # Configure system preferences.
      system.primaryUser = "asoka";
      system.defaults = {
        NSGlobalDomain."com.apple.swipescrolldirection" = false;

        WindowManager.EnableStandardClickToShowDesktop = false;

        finder.AppleShowAllFiles = true;
        finder.AppleShowAllExtensions = true;
        finder.ShowPathbar = true;
        finder.ShowStatusBar = true;

        dock.minimize-to-application = true;
        dock.mru-spaces = false;
        dock.show-recents = false;
        dock.persistent-others = [];
        dock.tilesize = 45;
      };

      security.pam.services.sudo_local = {
        enable = true;
        touchIdAuth = true;
      };

      # Custom fonts
      fonts.packages = [
        pkgs.nerd-fonts.jetbrains-mono
        # (pkgs.nerd-fonts.override { fonts = [ "JetBrainsMono" ]; })
      ];

      # Configure homebrew packages.
      homebrew.enable = true;
      homebrew.casks = [
        "1password"
        "adguard"
        "appcleaner"
        "cursor"
        "discord"
        "google-chrome"
        "google-drive"
        "imageoptim"
        "karabiner-elements"
        "obsidian"
        "orbstack"
        "orcaslicer"
        "postman"
        "raycast"
        "spotify"
        "steam"
        "vlc"
        "warp"
        "zoom"
      ];

      # TODO: Add Mac App Store apps.
    };
  in
  {
    darwinConfigurations."setup" = nix-darwin.lib.darwinSystem {
      system = "aarch64-darwin";
      modules = [
        configuration
        home-manager.darwinModules.home-manager {
          home-manager.useGlobalPkgs = true;
          home-manager.useUserPackages = true;
          home-manager.users.asoka = import ./home.nix;
        }
      ];
    };

    darwinPackages = self.darwinConfigurations."setup".pkgs;
  };
}
