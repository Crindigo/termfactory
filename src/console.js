import { TestCommand } from './commands/test';
import { HelpCommand } from './commands/help';
import { GatherCommand } from './commands/gather';
import { CommandHistory, CommandRegistry, CommandProcessor } from './commands/base';
import { EatCommand } from './commands/eat';
import { RecipeCommand } from './commands/recipe';
import { MakeCommand } from './commands/make';
import { RecipesCommand } from './commands/recipes';
import { ResearchCommand } from './commands/research';
import { BuildCommand } from './commands/build';
import { SudoCommand } from './commands/sudo';
import { UseCommand } from './commands/use';
import { NameCommand } from './commands/name';

export class TFConsole
{
    constructor(tf) {
        this.tf = tf;
        this.ps1 = 'home$';
        this.inputWrap = $('.input');
        this.consoleEl = $('.console');
        this.content = this.consoleEl.find('.nano-content');
        this.commandEl = $('#command');
        this.ps1El = $('#ps1');

        this.registry = new CommandRegistry();

        // processor can be swapped when entering a device. then when you leave, reset it back to rootProcessor.
        this.rootProcessor = new CommandProcessor(this.tf, this.registry);
        this.processor = this.rootProcessor;

        this.registry.add(new TestCommand());
        this.registry.add(new HelpCommand(this.registry));
        this.registry.add(new EatCommand());
        this.registry.add(new GatherCommand());
        this.registry.add(new RecipeCommand());
        this.registry.add(new RecipesCommand());
        this.registry.add(new MakeCommand());
        this.registry.add(new BuildCommand());
        this.registry.add(new NameCommand());
        this.registry.add(new ResearchCommand());
        this.registry.add(new SudoCommand());
        this.registry.add(new UseCommand());

        this.registry.alias('help', ['?', 'h']);
        this.registry.alias('test', 't');
        //this.registry.add(new CraftCommand());
        //this.registry.add(new InvCommand());
        //this.registry.alias('t', 'test');

        this.escapeEntities = {
            '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
        };

        this.history = new CommandHistory();

        this.commandEl.on('keydown', (e) => this.commandKeyDown(e));

        this.lockHolder = null;
    }

    scrollToEnd(force = false) {
        // if we are not at the bottom don't auto scroll
        var fullHeight = this.content[0].scrollHeight;
        if ( !force && this.content.height() + this.consoleEl.scrollTop() < fullHeight - 38 ) {
            return;
        }
        this.consoleEl.scrollTop(999999);
    }

    appendLine(line, classes = '') {
        line = this.escapeHtml(line);
        var isUser = classes && (' ' + classes + ' ').indexOf(' user ') !== -1;

        if ( !isUser ) {
            // replace {!foo bar}asdf{/} with <span class="foo bar">asdf</span>
            line = line.replace(/\{!([a-z0-9 -]+)}/g, '<span class="$1">');
            line = line.replace(/\{\/}/g, '</span>');
        }

        var $line = $('<div class="line"></div>').html(line);
        if ( classes ) {
            $line.addClass(classes);
        }
        this.content.append($line);
        //this.consoleEl.nanoScroller();
        this.scrollToEnd(isUser);

        return $line;
    }

    append(text, classes = '', prefix = '') {
        let line = prefix;
        const max = 100;
        let words = text.split(/\s+/);

        const stripfmt = text => text.replace(/\{!([a-z0-9 -]+)}/g, '').replace(/\{\/}/g, '')

        words.forEach(word => {
            if ( stripfmt(line).length + stripfmt(word).length + 1 > max ) {
                this.appendLine(line, classes);
                line = prefix + word + ' ';
            } else {
                line += word + ' ';
            }
        });
        if ( line.length ) {
            this.appendLine(line, classes);
        }
    }

    el() {
        return this.consoleEl;
    }

    cmdEl() {
        return this.commandEl;
    }

    focus() {
        this.commandEl.focus();
    }

    commandKeyDown(e) {
        let value = this.commandEl.val().trim();

        if (e.keyCode === 13) {
            if ( this.lockHolder ) {
                if ( value === 'stop' ) {
                    this.lockHolder.stop(this.tf);
                    this.lockHolder = null;
                } else {
                    this.history.add(value);
                    this.appendLine('> Busy. Type {!b}stop{/} to end current task.', 'error');
                }
                this.commandEl.val('');
                return;
            } else {
                if ( value === 'stop' ) {
                    // check if there is a current device and it can stop
                    if ( this.tf.devices.current && this.tf.devices.current.stop ) {
                        this.tf.devices.current.stop();
                    } else {
                        this.appendLine('> Nothing to stop.', 'error');
                    }
                    this.commandEl.val('');
                    return;
                }
            }

            // submit
            this.commandEl.val('');
            this.appendLine('$ ' + value, 'user');

            this.history.add(value);

            let ret = this.processor.run(value);
            if ( ret === undefined ) {
                return;
            }

            if ( ret === false ) {
                this.appendLine('> unknown error', 'error');
            } else if ( ret[0] === false ) {
                this.appendLine('> ' + ret[1], 'error');
            } else if ( ret[1] ) {
                if ( typeof ret[1] == 'string' ) {
                    this.appendLine(ret[1]);
                } else if ( Array.isArray(ret[1]) ) {
                    ret[1].forEach((l) => (typeof l == 'string') ? this.appendLine(l) : this.appendLine(l.line, l.classes));
                }
            }
        } else if (e.keyCode === 38 || e.keyCode === 40) {
            this.commandEl.val(this.history.navigate(value, e.keyCode == 38));
            setTimeout(() => this.setCursorPosToEnd(), 50);
        } else if (e.keyCode === 9) {
            // tab completion
            e.preventDefault();
            if (value === 'eat spa') {
                this.commandEl.val('eat spaghetti');
            }
            return false;
        }
    }

    lock(holder) {
        this.lockHolder = holder;
    }

    unlock() {
        this.lockHolder = null;
    }

    escapeHtml(str) {
        return ('' + str).replace(/[&<>"']/g, (c) => this.escapeEntities[c]);
    }

    setCursorPosToEnd() {
        let val = this.commandEl.val();
        this.setCursorPos(val.length);
    }

    setCursorPos(pos) {
        let el = this.commandEl[0];

        if ( el.setSelectionRange ) {
            el.setSelectionRange(pos, pos);
        } else if ( el.createTextRange ) {
            let range = el.createTextRange();
            range.collapse(true);
            range.moveEnd('character', pos);
            range.moveStart('character', pos);
            range.select();
        }
    }

    setPs1(text) {
        this.ps1 = text;
        this.ps1El.text(text);

        // resize
        const inputWidth = this.inputWrap.width();
        const ps1Width = this.ps1El.outerWidth();
        const commandOuter = this.commandEl.outerWidth() - this.commandEl.width();
        this.commandEl.width(inputWidth - ps1Width - commandOuter);
    }

    setInDevice(inDevice) {
        if ( inDevice ) {
            this.inputWrap.addClass('inDevice');
        } else {
            this.inputWrap.removeClass('inDevice');
        }
    }
}
