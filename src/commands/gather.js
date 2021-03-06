import { BaseCommand } from './base';
import { pickRandomKeys, numberFormatAbbr, tagRegexp, itemMatchesTagSpec } from '../utils';
import an from 'indefinite';
import GatherData from '../data/gathers.json';

export class GatherCommand extends BaseCommand
{
    constructor() {
        super();

        this.name = 'gather';
        this.patterns = [
            /^with\s+(?:a|an)\s+(.+)$/,
            /^with\s+(.+)$/,
            /^(.+)$/,
            true
        ];

        this.foundSomething = false;
        this.logLines = {};
        this.foundQty = {};
        this.tool = null;
        this.tryCount = 0;
        this.receivedStop = false;

        // map of toolspec -> { itemid -> chance }
        this.gatherData = GatherData;

        // cached data of item chances generated at command init
        this.gatherItems = {};
    }

    help() {
        return [
            'gather [with tool name]',
            'Start gathering materials, optionally using a tool. Each second there is a chance',
            'to collect an item. Tools can change the types of items you can collect.',
            'Gathering uses 1 stamina per second, and you will stop gathering if you run out.'
        ].join('\n');
    }

    run(tf, args) {
        this.tool = null;

        console.log(args);
        if ( args[1] ) {
            let tool = args[1];
            console.log(tool);

            // make sure the item exists
            let item = tf.items.find(tool);
            console.log(item);
            if ( !item ) {
                return [false, "You don't have " + an(tool) + "."];
            }

            // ordering this way because the messages make more sense.
            let stack = tf.player.findItemStack(item);
            if ( !stack ) {
                return [false, "You don't have " + an(tool) + "."];
            }
            if ( !item.tool ) {
                return [false, "The " + tool + " is not a tool."];
            }

            this.tool = stack;

            // damage the item (if damageable) for every found item
            // destroy the item if health is 0
            // if item is destroyed, check to see if the player has another of them. if so switch to that,
            // otherwise end the gathering.
        }

        // reset these
        this.foundQty = {};
        this.logLines = {};
        this.foundSomething = false;
        this.receivedStop = false;
        this.tryCount = 0;

        tf.console.lock(this);

        if ( this.tool ) {
            tf.console.appendLine(`Gathering materials with ${an(this.tool.item.name)}. Type {!b}stop{/} to finish.`)
        } else {
            tf.console.appendLine(`Gathering materials with your bare hands. Type {!b}stop{/} to finish.`);
        }

        this.cacheGatherItems();

        let fn = () => {
            let keepGoing = this.tick(tf);
            if ( keepGoing ) {
                setTimeout(fn, 1000);
            } else {
                tf.player.staminaChange += 1;
                tf.console.unlock();
            }
        };

        tf.player.staminaChange -= 1;
        setTimeout(fn, 1000);
    }

    stop(tf) {
        tf.console.appendLine('You stopped gathering items.');
        this.receivedStop = true;
    }

    cacheGatherItems() {
        this.gatherItems = {};
        console.log('this tool', this.tool);
        if ( !this.tool ) {
            this.gatherItems = this.gatherData["hand"];
        } else {
            for ( let toolSpec in this.gatherData ) {
                // toolSpec = "hand" or "item_id" or "tag:item_tag" or "tag:item_tag[1,)"
                if ( toolSpec === 'hand' ) {
                    continue;
                }

                // try a full match with tag + level bounds
                let m = toolSpec.match(tagRegexp);
                if ( m ) {
                    if ( !itemMatchesTagSpec(this.tool.item, m, toolSpec) ) {
                        continue;
                    }
                } else if ( toolSpec !== this.tool.item.id ) {
                    continue;
                }
                
                // go through the list of items and add it to gatherItems.
                // if it already exists in gatherItems, use the highest value.
                let itemList = this.gatherData[toolSpec];
                for ( let itemId in itemList ) {
                    if ( itemId === '//' ) {
                        continue;
                    }
                    let chance = itemList[itemId];
                    if ( this.gatherItems[itemId] ) {
                        this.gatherItems[itemId] = Math.max(chance, this.gatherItems[itemId]);
                    } else {
                        this.gatherItems[itemId] = chance;
                    }
                }
            }
        }

        if ( Object.keys(this.gatherItems).length === 0 ) {
            this.gatherItems = this.gatherData["hand"];
        }

        if ( this.gatherItems["//"] ) {
            delete this.gatherItems["//"];
        }
    }

    tick(tf) {
        if ( this.receivedStop ) {
            return false;
        }

        if ( tf.player.stamina < 1 ) {
            tf.console.appendLine('Stopped gathering items because you ran out of stamina.', 'tip');
            return false;
        }

        // there exists the potential for the tool to run out due to usage in a device, so check the qty here.
        // we need to have this up here as well because we can't find an item with a missing tool!
        if ( this.tool && this.tool.qty < 1 ) {
            tf.console.appendLine('Your tool broke, stopped gathering items.', 'tip');
            return false;
        }

        // for bare hands, add a 30 minute limit before the user needs to come back
        this.tryCount++;
        if ( !this.tool && this.tryCount >= 1800 ) {
            tf.console.appendLine('Your hands are getting dirty and chapped, so you stopped.', 'tip');
            return false;
        }

        tf.player.stamina -= 1; // keep this under the tool check since no attempt was made to gather yet.

        let foundItems = pickRandomKeys(this.gatherItems);
        if ( foundItems.length === 0 ) {
            return true;
        }

        if ( !this.foundSomething ) {
            tf.console.appendLine('Found:');
            this.foundSomething = true;
        }

        // loop thru found item ids. there can be multiple of the same item id.
        foundItems.forEach(itemId => {
            let stack = tf.items.get(itemId).stack(1);
            tf.player.addItemStack(stack);

            if ( this.logLines[itemId] ) {
                this.foundQty[itemId]++;
                this.logLines[itemId].find('.qty').text(numberFormatAbbr(this.foundQty[itemId]));
            } else {
                this.foundQty[itemId] = 1;
                this.logLines[itemId] = tf.console.appendLine('  ' + stack.item.name + ' ({!qty}1{/})');
            }
        });

        // tools are no longer randomly breakable. however, the stack quantity is their durability,
        // and recipes can make 20, 100, etc. of the tool.
        if ( this.tool ) {
            tf.player.inventory.reduce(this.tool);
        }

        // there exists the potential for the tool to run out due to usage in a device, so check the qty here.
        // this also handles the case where qty is <= 0 after it breaks above.
        if ( this.tool && this.tool.qty <= 0 ) {
            tf.console.appendLine('Your tool broke, stopped gathering items.', 'tip');
            return false;
        }

        return true;
    }
}
