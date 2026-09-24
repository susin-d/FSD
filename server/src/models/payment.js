import mongoose from 'mongoose';

const PaymentSchema = new mongoose.Schema({
    user : {
        type : mongoose.Schema.Types.ObjectId,
        ref : 'User',
        required : true
    },
    amount : {
        type : Number,
        required : true
    },
    service : {
        type : String,
        required : true
    }
},{
        timestamps: true
    }
);

const payment = mongoose.model('payment',PaymentSchema);

export default payment;