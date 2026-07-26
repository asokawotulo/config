{ pkgs, ... }:

let
  firecrawl-cli = pkgs.stdenvNoCC.mkDerivation {
    pname = "firecrawl-cli";
    version = "1.19.27";

    src = pkgs.fetchurl {
      url = "https://github.com/firecrawl/cli/releases/download/v1.19.27/firecrawl-darwin-arm64.tar.gz";
      hash = "sha256-O8jQ/7t1YwjYBzvv8rppqoQpHihjCzUjkWXcybVF/R4=";
    };

    sourceRoot = ".";
    dontStrip = true;

    installPhase = ''
      install -Dm755 firecrawl-darwin-arm64 "$out/bin/firecrawl"
    '';

    meta = {
      description = "Command-line interface for Firecrawl web data extraction";
      homepage = "https://github.com/firecrawl/cli";
      license = pkgs.lib.licenses.isc;
      mainProgram = "firecrawl";
      platforms = [ "aarch64-darwin" ];
    };
  };
in
{
  environment.systemPackages = [ firecrawl-cli ];
}
