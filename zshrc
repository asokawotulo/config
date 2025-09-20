# zmodload zsh/zprof

# Path to your oh-my-zsh installation.
export ZSH="$HOME/.oh-my-zsh"
export TZ="Asia/Jakarta"

# Theme
ZSH_THEME=""

# Oh My Zsh
zstyle ':omz:update' mode auto  # disabled|auto|reminder
zstyle ':omz:update' frequency 3

# ZSH Cache
ZSH_COMPDUMP="$ZSH/cache/completions/.zcompdump-${HOST/.*/}-${ZSH_VERSION}"

# Disable auto-setting terminal title
DISABLE_AUTO_TITLE="true"

plugins=(
	git
	laravel
	composer
	direnv
	starship
	bun
	aws
)

# LS Colors
export CLICOLOR="1"
export LSCOLORS="ExFxBxDxCxegedabagacad"

# VirtualEnv
export VIRTUAL_ENV_DISABLE_PROMPT=1

# Source Oh My Zsh
source $ZSH/oh-my-zsh.sh

# Source Functions
if [ -f $HOME/.functions ]; then
	source $HOME/.functions
fi

# Rust
if [ -f $HOME/.cargo/env ]; then
	source $HOME/.cargo/env
fi

# Aliases
alias c="cursor"
alias ll="ls -lhA"
alias pat="php artisan tinker"
alias speed="speedtest -u auto-decimal-bytes"
alias nix_update="nix flake update"
alias nix_switch="sudo darwin-rebuild switch --flake ~/config/nix#setup"
alias update="brew update && omz update"
alias upgrade="brew upgrade && brew cleanup"
alias clean="brew cleanup -s --prune=1" # TODO: Add more cleaning options

# pnpm
export PNPM_HOME="$HOME/Library/pnpm"
case ":$PATH:" in
  *":$PNPM_HOME:"*) ;;
  *) export PATH="$PNPM_HOME:$PATH" ;;
esac
# pnpm end
