# zmodload zsh/zprof

# Path to your oh-my-zsh installation.
export ZSH="$HOME/.oh-my-zsh"
export TZ="Asia/Jakarta"

# Theme
# ZSH_THEME="spaceship"
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
export PATH="/opt/homebrew/opt/mysql-client/bin:$PATH"

# Source Oh My Zsh
source $ZSH/oh-my-zsh.sh

# Source Functions
if [ -f $HOME/.functions ]; then
	source $HOME/.functions
fi

# Spaceship Config
# if [ -f $HOME/.spaceshipconfig ]; then
# 	source $HOME/.spaceshipconfig
# fi

# Rust
if [ -f $HOME/.cargo/env ]; then
	source $HOME/.cargo/env
fi

# Aliases
alias pat="php artisan tinker"
alias speed="speedtest -u auto-decimal-bytes"
alias ll="ls -lhA"
alias c="cursor"

# http() {
# 	# echo "http $@"
# 	nix run nixpkgs#httpie -- $@
# 	# nix-shell -p httpie --command "http "$@""
# }

# Config
export XDG_CONFIG_HOME="$HOME/.config"
. "$HOME/.local/bin/env"
