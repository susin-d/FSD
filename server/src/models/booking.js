import mongoose from 'mongoose';

const bookingScheme = new mongoose.Schema({
    slotsId : {
        type : mongoose.Schema.Types.ObjectId,
        ref : 'Provider',
        required : true
    },
    userId :{
        type : mongoose.Schema.Types.ObjectId,
        ref : 'Users',
        required : true
    },
    status : {
        type : String,
        enum : ['Confirmed','Cancelled'],
        default : 'Confirmed'
    },
    bookedAt :{
        type : Date,
        default : Date.now
    },
    cancelled : {
        type : Date
    }
},{
    timestamps : true
});