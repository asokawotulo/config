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
      # NOTE: Packages here are those that we don't care about being kept up to date independently from nixpkgs. If we want to keep them up to date, we should add them to the homebrew configuration (./brew.nix).
      environment.systemPackages =
        [
          # Development tools
          pkgs.ast-grep
          pkgs.bun
          pkgs.devenv
          pkgs.direnv
          pkgs.fzf
          pkgs.git-lfs
          pkgs.go
          pkgs.just
          pkgs.mkcert
          pkgs.nodejs_22
          pkgs.pnpm
          pkgs.ripgrep
          pkgs.starship
          pkgs.terminal-notifier
          pkgs.tree
          pkgs.uv
          pkgs.yarn
          pkgs.zig_0_14
          pkgs.zoxide

          # Infrastructure & DevOps
          pkgs.awscli2
          pkgs.packer
          pkgs.terraform

          # Network & testing tools
          pkgs.httpie
          pkgs.ngrok
          pkgs.oha
          pkgs.ookla-speedtest

          # Database
          pkgs.mysql84
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
      ];

      # Import homebrew configuration
      imports = [ ./brew.nix ];
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