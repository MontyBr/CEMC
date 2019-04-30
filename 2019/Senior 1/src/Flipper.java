/*
CCC 2019 Question 1
O(n) time
V1.0

TODO = convert from cmd to swing executable
TODO = make usable for MxN
TODO = iterate over input
TODO = add diagonal flips
TODO = add 90 degree rotations
*/

import java.util.Scanner;

public class Flipper {

    public static void main(String[] args){
        int [][] input = new int[2][2];
        Scanner scan = new Scanner(System.in);
        boolean inputBool = false;
        char[] flip;
        String temp;


        System.out.println("2x2 matrix flipper");

        //top left
        System.out.println("Please input the top left number:");
        while(!inputBool) {
            temp = scan.nextLine();
            if (isStringInt(temp)){
                input[0][0] = Integer.parseInt(temp);
                inputBool = true;
            }
            else{
                System.out.println("Not an integer. Please enter the top left number:");
            }
        }

        //top right
        System.out.println("Please input the top right number:");
        inputBool=false;
        while(!inputBool) {
            temp = scan.nextLine();
            if (isStringInt(temp)){
                input[0][1] = Integer.parseInt(temp);
                inputBool = true;
            }
            else{
                System.out.println("Not an integer. Please enter the top right number:");
            }
        }

        //bottom left
        System.out.println("Please input the bottom left number:");
        inputBool=false;
        while(!inputBool) {
            temp = scan.nextLine();
            if (isStringInt(temp)){
                input[1][0] = Integer.parseInt(temp);
                inputBool = true;
            }
            else{
                System.out.println("Not an integer. Please enter the top right number:");
            }
        }

        //bottom right
        System.out.println("Please input the bottom right number:");
        inputBool=false;
        while(!inputBool) {
            temp = scan.nextLine();
            if (isStringInt(temp)){
                input[1][1] = Integer.parseInt(temp);
                inputBool = true;
            }
            else{
                System.out.println("Not an integer. Please enter the bottom right number:");
            }
        }

        System.out.println("Please input the flip order (only insert the chars h or v):");

        temp = scan.nextLine();
        flip = temp.toCharArray();
        for(int i = 0; i < flip.length; i++){
            if("hvHV".indexOf(flip[i]) == -1){
                System.out.println("You have submitted an illegal char. Please only inset any combination of h or v:");
                temp = scan.nextLine();
                flip = temp.toCharArray();
                i = 0;
            }
        }

        System.out.println("\n\n\n" + input[0][0]+ " " + input[0][1] +"\n" + input[1][0]+ " " + input[1][1] + "\n\n" + temp);
        pressAnyKeyToContinue();


        input = flipper(input,flip);
        System.out.println(input[0][0]+ " " + input[0][1] +"\n" + input[1][0]+ " " + input[1][1]);
    }


    public static int [][] flipper(int[][] box, char[] c){
        for(char x : c){

            int a;
            int b;

            if(x == 'v' || x == 'V'){
                a = box[0][0];
                b = box[1][0];

                box[0][0]=box[0][1];
                box[1][0]=box[1][1];
                box[0][1]=a;
                box[1][1]=b;
            }
            else if(x == 'h' || x == 'H'){
                a = box[0][0];
                b = box[0][1];

                box[0][0]=box[1][0];
                box[0][1]=box[1][1];
                box[1][0]=a;
                box[1][1]=b;
            }
        }
        return box;
    }

    private static void pressAnyKeyToContinue()
    {
        System.out.println("Press Enter key to continue...");
        try
        {
            System.in.read();
        }
        catch(Exception e)
        {}
    }

    public static boolean isStringInt(String s)
    {
        try
        {
            Integer.parseInt(s);
            return true;
        } catch (NumberFormatException ex)
        {
            return false;
        }
    }
}
