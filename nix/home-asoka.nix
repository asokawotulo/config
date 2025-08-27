{ config, pkgs, ... }:

{
  home.username = "asoka";
  home.homeDirectory = "/Users/asoka";
  home.stateVersion = "24.05";

  home.packages = [];

  programs.home-manager.enable = true;

  targets.darwin.defaults = import ./darwin-configuration.nix;
}