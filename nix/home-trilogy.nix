{ config, pkgs, ... }:

{
  home.username = "trilogy";
  home.homeDirectory = "/Users/trilogy";
  home.stateVersion = "24.05";

  home.packages = [];

  programs.home-manager.enable = true;

  targets.darwin.defaults = import ./darwin-configuration.nix;
}