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
    # Define your users here
    users = [
      "asoka"
      # "trilogy"
    ];
    
    # Helper function to create user configurations
    createUserConfig = username: {
      home = "/Users/${username}";
    };
    
    # Helper function to create home-manager configurations
    createHomeManagerConfig = username: {
      home.username = username;
      home.homeDirectory = "/Users/${username}";
      home.stateVersion = "24.05";
      home.packages = [];
      programs.home-manager.enable = true;
      # TODO: Find a better way to declare configurations. Ideally, with home manager configuration and type hinting.
      targets.darwin.defaults = import ./darwin-configuration.nix;
    };

    configuration = { pkgs, ... }: {
      # Dynamically create user configurations
      users.users = builtins.listToAttrs (
        map (username: {
          name = username;
          value = createUserConfig username;
        }) users
      );

      # nix.configureBuildUsers = true;
      # nix.useDaemon = true;
      # services.nix-daemon.enable = true;

      # Nix configurations.
      nix.settings.experimental-features = "nix-command flakes";
      nix.settings.trusted-users = [ "root" ] ++ users;

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
          pkgs.pnpm
          pkgs.php81
          pkgs.go
          pkgs.uv
          # TODO: Add packages from homebrew that are available in nixpkgs.
        ];

      # Create /etc/zshrc that loads the nix-darwin environment.
      programs.zsh = {
        enable = true;
        enableCompletion = false;
      };

      # Set Git commit hash for darwin-version.
      system.configurationRevision = self.rev or self.dirtyRev or null;
      system.stateVersion = 5;

      # Configure system preferences.
      system.primaryUser = "asoka";

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
      homebrew = {
        enable = true;
        brews = [
          "opencode"
        ];
        casks = [
          "1password"
          "adguard"
          "appcleaner"
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
          # Dynamically create home-manager configurations
          home-manager.users = builtins.listToAttrs (
            map (username: {
              name = username;
              value = createHomeManagerConfig username;
            }) users
          );
        }
      ];
    };

    darwinPackages = self.darwinConfigurations."setup".pkgs;
  };
}