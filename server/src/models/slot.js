import mongoose from 'mongoose';

const slotSchema = new mongoose.Schema({
    providerId : {
        type : mongoose.Schema.Types.ObjectId,
        ref : 'Provider',
        required : true,
        unique : true
    },
    startsAt : {
        type : Date,
        required : true
    },
    endsAt : {
        type : Date,
        required : true
    },
});

const slots = mongoose('Slots',slotSchema);

export default slots;