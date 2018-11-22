import { CommandProcessor, CommandRegistry, BaseCommand } from "../commands/base";
import { RecipeCommand } from "../commands/recipe";
import { RecipesCommand } from "../commands/recipes";

/**
 * The device "class" which contains information applying to all instances of the device.
 */
export class BaseDeviceClass
{
    constructor(tf) {
        this.tf = tf;

        // set up the custom command registry and processor. the use command will set tf.console.processor
        // to this.processor and quit/exit/leave will set it back to tf.console.rootProcessor.
        this.registry = new CommandRegistry();
        this.processor = new CommandProcessor(this.tf, this.registry);

        this.registry.add(new QuitCommand(), true);
        this.registry.alias('quit', ['exit', 'leave', 'bye', 'q']);
    }

    addRecipeSupport(deviceId, interactive) {
        this.registry.add(new RecipeCommand(deviceId));
        this.registry.add(new RecipesCommand(deviceId));
        this.registry.add(new DeviceMakeCommand(deviceId, interactive));
        this.registry.alias('make', ['build']);
    }

    /**
     * Create a fresh device instance after finishing construction.
     * 
     * @param {string} name 
     */
    newDevice(name) {
        return new BaseDevice(this, name);
    }

    /**
     * Load a device instance from save data.
     * 
     * @param {object} data 
     */
    loadDevice(data) {

    }
}

/**
 * Instance of a device.
 */
export class BaseDevice
{
    constructor(deviceClass, name) {
        this.deviceClass = deviceClass;
        this.name = name;
        this.tf = deviceClass.tf;
    }

    renderList() {
        return '{!item}' + this.name.substr(0, 34) + '{/}';
    }

    tick() {

    }
}

class QuitCommand extends BaseCommand
{
    constructor() {
        super();
        this.name = 'quit';
        this.patterns = [true];
    }

    run(tf, args) {
        tf.devices.current = null;
        tf.console.appendLine('You stopped using the device.', 'tip');
        tf.console.processor = tf.console.rootProcessor;
        tf.console.setPs1('home$');
    }
}

/**
 * Works similar to the build command, but is flexible enough to create items, support, and devices.
 * It can also create multiple items at a time.
 * Should include a status line saying "working" or "paused (reason)".
 * If it's used to make devices, and you run out of land, then it SHOULD stop, not just pause.
 * 
 * If the device consumes power and not stamina, the command does NOT lock the console, and also
 * needs to tell the device to start working on the recipe. tf.devices.current contains the device
 * instance we are currently using. Probably don't show a progress bar or status if it does not lock,
 * instead note that it's running in the background. In the future we can put status in the sidebar
 * in the devices tab via the device's renderList() method. The tick() method in the device will
 * be responsible for reducing power and input items, and creating output items.
 * 
 * The stop command when used in the device should stop any background crafting.
 * The console handler will try to find and call a stop() method on the device instance.
 * 
 * Note that it should run in the background if there is no stamina usage, even if no power is used.
 * Like brick forming is just waiting for it to dry.
 * 
 * BIG NOTE: Devices that can make other support/devices will likely have to be limited to 1.
 * Otherwise you could have more than one of a single device type in progress which isn't possible.
 * Either that or we have to update itemProgress in commands to always use the progress in the
 * devices/supports registry.
 */
export class DeviceMakeCommand extends BaseCommand
{
    constructor(deviceId, interactive) {
        super();

        this.name = 'make';
        this.patterns = [
            /^(?<qty>\d+)\s+(?<name>.+)$/,
            /^(an?\s+)?(?<name>.+)$/
        ];
        
        this.deviceId = deviceId;
        this.interactive = interactive;

        this.receivedStop = false;
        
        this.itemProgress = 0;
        this.progress = 0;
        this.progressLine = null;

        this.recipe = null;
        this.craftedQty = 0;
        this.desiredQty = 1;
        this.item = null;
        
        this.staminaDrain = 0;
        this.powerDrain = 0;
    }

    help() {
        return [
            'make [qty] item name',
            'Uses the device to create an item or a structure. Unlike making things in your hand,',
            'all the items are not required up front, it will just consume a small amount per tick',
            'and will only proceed if all requirements are met.'
        ].join("\n");
    }

    run(tf, args) {
        this.recipe = null;

        let qty = args.qty || 1;
        let itemName = args.name;

        // make sure the item exists
        let item = tf.items.find(itemName);
        if ( !item ) {
            return [false, "You can't build " + an(itemName) + "."];
        }

        let recipe = tf.crafting.findRecipeByOutput(this.deviceId, item.id);
        if ( !recipe ) {
            return [false, "You can't build " + an(itemName) + "."];
        }

        // We need to check the registry of Support and Device to see if there's any partially completed
        // objects of this type. if so, resume that instead of making a totally new one.
        let makeNew = true;
        if ( item.category === 'support' ) {
            makeNew = !tf.support.hasIncomplete(item.id);
        } else if ( item.category === 'device' ) {
            makeNew = !tf.devices.hasIncomplete(item.id);
        }

        // check land requirements
        if ( makeNew && item.category === 'device' && (item.land * qty) > tf.freeLand() ) {
            return [false, "There's not enough room to build this."];
        }

        // no need to check for missing items

        // reset props
        this.receivedStop = false;
        this.progress = 0;
        this.itemProgress = 0;
        this.craftedQty = 0;
        this.desiredQty = qty;

        // create a progress bar, and update the UI for stamina regen
        this.recipe = recipe;
        this.item = item;

        if ( makeNew ) {
            tf.console.appendLine(`You started building ${an(item.name)}.`);
        } else {
            tf.console.appendLine(`You resumed construction of the ${item.name}.`);
            this.itemProgress = tf.support.getProgress(item.id);
            this.progress = this.itemProgress;
        }

        if ( makeNew ) {
            if ( item.category === 'support' ) {
                tf.support.startConstruction(item.id);
            } else if ( item.category === 'device' ) {
                tf.devices.startConstruction(item.id);

                // allocate the land for this. have to do this when each new item is being built since
                // only one can be in progress at the same time.
                tf.land += this.item.land;
            }
        }

        if ( this.interactive ) {
            this.runInteractive(tf, args);
        } else {
            this.runBackground(tf, args);
        }
        this.progressLine = tf.console.appendLine(progressBar(this.progress, recipe.time, 100));

        this.staminaDrain = recipe.stamina / recipe.time;
        tf.player.staminaChange -= this.staminaDrain;
        
    }

    runInteractive(tf, args) {
        tf.console.lock(this);

        let fn = () => {
            let keepGoing = this.tick(tf);
            if ( keepGoing ) {
                setTimeout(fn, 1000);
            } else {
                tf.player.staminaChange += this.staminaDrain;
                tf.console.unlock();
            }
        };
        setTimeout(fn, 1000);
    }

    runBackground(tf, args) {
        // The current device instance being used
        let device = tf.devices.current;
    }

    stop(tf) {
        this.receivedStop = true;
        tf.console.appendLine("You decided to take a break for now.");
    }

    tick(tf) {
        if ( this.receivedStop ) {
            return false;
        }

        // check stamina
        if ( tf.player.stamina < this.staminaDrain ) {
            return true;
        }

        // check for this tick's required items.
        // the desired qty is just 1 over the total ticks required.
        if ( !this.recipe.canCraft(tf.player.inventory, 1 / this.recipe.time) ) {
            return true;
        }

        // take from stamina and inventory
        tf.player.stamina -= this.staminaDrain;
        this.recipe.pullFromInventory(tf.player.inventory, 1 / this.recipe.time);

        // increment all progress types and update the UI
        this.itemProgress++;
        this.progress++;
        this.updateProgress();

        if ( this.item.category === 'support' ) {
            tf.support.incrementProgress(this.item.id);
        } else if ( this.item.category === 'device' ) {
            tf.devices.incrementProgress(this.item.id);
        }

        // Finished a single recipe
        if ( this.itemProgress >= this.recipe.time ) {
            // Add the output to the inventory, or finish the construction on support/device.
            Object.keys(this.recipe.output).forEach(itemId => {
                const item = tf.items.get(itemId);
                const qty = this.recipe.output[itemId];

                if ( item.category === 'item' ) {
                    tf.player.addItemStack(item.stack(qty));
                } else if ( item.category === 'support' ) {
                    tf.support.finishConstruction(item.id);
                } else if ( item.category === 'device' ) {
                    tf.devices.finishConstruction(item.id);
                }
            });

            // Increment the # of crafted recipes and update UI
            this.craftedQty++;
            this.updateProgress();

            // If we're done, return false.
            if ( this.craftedQty >= this.desiredQty ) {
                tf.console.appendLine(`You've finished building the ${this.item.name}!`, 'tip');
                return false;
            } else {
                // Not done yet.
                // Start the next recipe. For devices and support, we need to check land and start new construction.
                this.itemProgress = 0;

                if ( item.category === 'support' ) {
                    tf.support.startConstruction(item.id);
                } else if ( item.category === 'device' ) {
                    // allocate the land for this. have to do this when each new item is being built since
                    // only one can be in progress at the same time.
                    if ( this.item.land > tf.freeLand() ) {
                        return false;
                    }
                    tf.land += this.item.land;
                    
                    tf.devices.startConstruction(item.id);
                }
            }
        }

        return true;
    }

    updateProgress() {
        this.progressLine.text(progressBar(
            this.progress, this.recipe.time * this.desiredQty, 90) + ` ${this.craftedQty}/${this.desiredQty}`);
    }
}